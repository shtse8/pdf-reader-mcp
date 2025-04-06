import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { resolvePath } from '../../src/utils/pathUtils.js';
import * as pathUtils from '../../src/utils/pathUtils.js'; // Import the module itself for spying

// Define a type for the expected structure after JSON.parse
type ExpectedResultType = {
  results: { source: string; success: boolean; data?: object; error?: string }[];
};

// --- Mocking pdfjs-dist ---
const mockGetMetadata = vi.fn();
const mockGetPage = vi.fn();
const mockGetDocument = vi.fn();
const mockReadFile = vi.fn();

vi.doMock('pdfjs-dist/legacy/build/pdf.mjs', () => {
  return {
    getDocument: mockGetDocument,
  };
});
vi.doMock('node:fs/promises', () => {
  return {
    default: {
      readFile: mockReadFile,
    },
    readFile: mockReadFile,
    __esModule: true,
  };
});

// Dynamically import the handler *once* after mocks are defined
// Define a more specific type for the handler's return value content
type HandlerResultContent = { type: string; text: string };
let handler: (args: unknown) => Promise<{ content: HandlerResultContent[] }>;

beforeAll(async () => {
  // Only import the tool definition now
  const { readPdfToolDefinition: importedDefinition } = await import(
    '../../src/handlers/readPdf.js'
  );
  handler = importedDefinition.handler;
});

// Renamed describe block as it now only tests the handler
describe('handleReadPdfFunc Integration Tests', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset mocks for pathUtils if we spy on it
    vi.spyOn(pathUtils, 'resolvePath').mockImplementation((p) => p); // Simple mock for resolvePath

    mockReadFile.mockResolvedValue(Buffer.from('mock pdf content'));

    const mockDocumentAPI = {
      numPages: 3,
      getMetadata: mockGetMetadata,
      getPage: mockGetPage,
    };
    const mockLoadingTaskAPI = { promise: Promise.resolve(mockDocumentAPI) };
    mockGetDocument.mockReturnValue(mockLoadingTaskAPI);
    mockGetMetadata.mockResolvedValue({
      info: { PDFFormatVersion: '1.7', Title: 'Mock PDF' },
      metadata: {
        _metadataMap: new Map([['dc:format', 'application/pdf']]),
        get(key: string) { return this._metadataMap.get(key); },
        has(key: string) { return this._metadataMap.has(key); },
        getAll() { return Object.fromEntries(this._metadataMap); },
      },
    });
    // eslint-disable-next-line @typescript-eslint/require-await
    mockGetPage.mockImplementation(async (pageNum: number) => {
      if (pageNum > 0 && pageNum <= mockDocumentAPI.numPages) {
        return {
          getTextContent: vi
            .fn()
            .mockResolvedValueOnce({ items: [{ str: `Mock page text ${String(pageNum)}` }] }),
        };
      }
      throw new Error(`Mock getPage error: Invalid page number ${String(pageNum)}`);
    });
  });

  // Removed unit tests for parsePageRanges

  // --- Integration Tests for handleReadPdfFunc ---

  it('should successfully read full text, metadata, and page count for a local file', async () => {
    const args = {
      sources: [{ path: 'test.pdf' }],
      include_full_text: true,
      include_metadata: true,
      include_page_count: true,
    };
    const result = await handler(args);
    const expectedData = {
      results: [
        {
          source: 'test.pdf',
          success: true,
          data: {
            info: { PDFFormatVersion: '1.7', Title: 'Mock PDF' },
            metadata: { 'dc:format': 'application/pdf' },
            num_pages: 3,
            full_text: 'Mock page text 1\n\nMock page text 2\n\nMock page text 3',
          },
        },
      ],
    };

    expect(mockReadFile).toHaveBeenCalledWith(resolvePath('test.pdf'));
    expect(mockGetDocument).toHaveBeenCalledWith(Buffer.from('mock pdf content'));
    expect(mockGetMetadata).toHaveBeenCalled();
    expect(mockGetPage).toHaveBeenCalledTimes(3);

    // Add check for content existence and access safely, disable ESLint rule
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        expect(result.content[0].type).toBe('text');
        expect(JSON.parse(result.content[0].text) as ExpectedResultType).toEqual(expectedData);
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

  it('should successfully read specific pages for a local file', async () => {
    const args = {
      sources: [{ path: 'test.pdf', pages: [1, 3] }],
      include_metadata: false,
      include_page_count: true,
    };
    const result = await handler(args);
    const expectedData = {
      results: [
        {
          source: 'test.pdf',
          success: true,
          data: {
            num_pages: 3,
            page_texts: [
              { page: 1, text: 'Mock page text 1' },
              { page: 3, text: 'Mock page text 3' },
            ],
          },
        },
      ],
    };
    expect(mockGetPage).toHaveBeenCalledTimes(2);
    expect(mockGetPage).toHaveBeenCalledWith(1);
    expect(mockGetPage).toHaveBeenCalledWith(3);
    expect(mockReadFile).toHaveBeenCalledWith(resolvePath('test.pdf'));
    expect(mockGetDocument).toHaveBeenCalledWith(Buffer.from('mock pdf content'));
    expect(mockGetMetadata).not.toHaveBeenCalled();

    // Add check for content existence and access safely, disable ESLint rule
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        expect(result.content[0].type).toBe('text');
        expect(JSON.parse(result.content[0].text) as ExpectedResultType).toEqual(expectedData);
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

  it('should successfully read specific pages using string range', async () => {
    const args = {
      sources: [{ path: 'test.pdf', pages: '1,3-3' }],
      include_page_count: true,
    };
    const result = await handler(args);
    const expectedData = {
      results: [
        {
          source: 'test.pdf',
          success: true,
          data: {
            info: { PDFFormatVersion: '1.7', Title: 'Mock PDF' },
            metadata: { 'dc:format': 'application/pdf' },
            num_pages: 3,
            page_texts: [
              { page: 1, text: 'Mock page text 1' },
              { page: 3, text: 'Mock page text 3' },
            ],
          },
        },
      ],
    };
    // Add check for content existence and access safely, disable ESLint rule
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        expect(JSON.parse(result.content[0].text) as ExpectedResultType).toEqual(expectedData);
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

  it('should successfully read metadata only for a URL', async () => {
    const testUrl = 'http://example.com/test.pdf';
    const args = {
      sources: [{ url: testUrl }],
      include_full_text: false,
      include_metadata: true,
      include_page_count: false,
    };
    const result = await handler(args);
    const expectedData = {
      results: [
        {
          source: testUrl,
          success: true,
          data: {
            info: { PDFFormatVersion: '1.7', Title: 'Mock PDF' },
            metadata: { 'dc:format': 'application/pdf' },
          },
        },
      ],
    };
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockGetDocument).toHaveBeenCalledWith({ url: testUrl });
    expect(mockGetMetadata).toHaveBeenCalled();
    expect(mockGetPage).not.toHaveBeenCalled();
    // Add check for content existence and access safely, disable ESLint rule
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        expect(result.content[0].type).toBe('text');
        expect(JSON.parse(result.content[0].text) as ExpectedResultType).toEqual(expectedData);
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

  it('should handle multiple sources with different options', async () => {
    const urlSource = 'http://example.com/another.pdf';
    const args = {
      sources: [
        { path: 'local.pdf', pages: [1] },
        { url: urlSource },
      ],
      include_full_text: true,
      include_metadata: true,
      include_page_count: true,
    };
    // eslint-disable-next-line @typescript-eslint/require-await
    const secondMockGetPage = vi.fn().mockImplementation(async (pageNum: number) => {
      if (pageNum > 0 && pageNum <= 2) {
        return {
          getTextContent: vi
            .fn()
            .mockResolvedValueOnce({ items: [{ str: `URL Mock page text ${String(pageNum)}` }] }),
        };
      }
      throw new Error(`Mock getPage error: Invalid page number ${String(pageNum)}`);
    });
    const secondMockDocumentAPI = {
      numPages: 2,
      getMetadata: mockGetMetadata,
      getPage: secondMockGetPage,
    };
    const secondLoadingTaskAPI = { promise: Promise.resolve(secondMockDocumentAPI) };
    mockGetDocument.mockReset();
    const defaultMockDocumentAPI = {
      numPages: 3,
      getMetadata: mockGetMetadata,
      getPage: mockGetPage,
    };
    const defaultLoadingTask = { promise: Promise.resolve(defaultMockDocumentAPI) };
    mockGetDocument
      .mockReturnValueOnce(defaultLoadingTask)
      .mockReturnValueOnce(secondLoadingTaskAPI);

    const result = await handler(args);
    const expectedData = {
      results: [
        {
          source: 'local.pdf',
          success: true,
          data: {
            info: { PDFFormatVersion: '1.7', Title: 'Mock PDF' },
            metadata: { 'dc:format': 'application/pdf' },
            num_pages: 3,
            page_texts: [{ page: 1, text: 'Mock page text 1' }],
          },
        },
        {
          source: urlSource,
          success: true,
          data: {
            info: { PDFFormatVersion: '1.7', Title: 'Mock PDF' },
            metadata: { 'dc:format': 'application/pdf' },
            num_pages: 2,
            full_text: 'URL Mock page text 1\n\nURL Mock page text 2',
          },
        },
      ],
    };
    expect(mockReadFile).toHaveBeenCalledOnce();
    expect(mockReadFile).toHaveBeenCalledWith(resolvePath('local.pdf'));
    expect(mockGetDocument).toHaveBeenCalledTimes(2);
    expect(mockGetDocument).toHaveBeenCalledWith(Buffer.from('mock pdf content'));
    expect(mockGetDocument).toHaveBeenCalledWith({ url: urlSource });
    expect(mockGetPage).toHaveBeenCalledTimes(1);
    expect(secondMockGetPage).toHaveBeenCalledTimes(2);
    // Add check for content existence and access safely, disable ESLint rule
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        expect(JSON.parse(result.content[0].text) as ExpectedResultType).toEqual(expectedData);
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

  // --- Error Handling Tests ---

  it('should return error if local file not found', async () => {
    const error = new Error('Mock ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockReadFile.mockRejectedValue(error);
    const args = { sources: [{ path: 'nonexistent.pdf' }] };
    const result = await handler(args);
    const expectedData = {
      results: [
        {
          source: 'nonexistent.pdf',
          success: false,
          error: `File not found at 'nonexistent.pdf'. Resolved to: nonexistent.pdf`,
        },
      ],
    };
    // Add check for content existence and access safely, disable ESLint rule
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        expect(JSON.parse(result.content[0].text) as ExpectedResultType).toEqual(expectedData);
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

  it('should return error if pdfjs fails to load document', async () => {
    const loadError = new Error('Mock PDF loading failed');
    const failingLoadingTask = { promise: Promise.reject(loadError) };
    mockGetDocument.mockReturnValue(failingLoadingTask);
    const args = { sources: [{ path: 'bad.pdf' }] };
    const result = await handler(args);
    // Add check for content existence and access safely, disable ESLint rule
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        const parsedResult = JSON.parse(result.content[0].text) as ExpectedResultType;
        expect(parsedResult.results[0]).toBeDefined();
        if (parsedResult.results[0]) {
            expect(parsedResult.results[0].success).toBe(false);
            expect(parsedResult.results[0].error).toBe(
              `MCP error -32600: Failed to load PDF document. Reason: ${loadError.message}`
            );
        }
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

  it('should throw McpError for invalid input arguments (Zod error)', async () => {
    const args = { sources: [{ path: 'test.pdf' }], include_full_text: 'yes' };
    await expect(handler(args)).rejects.toThrow(McpError);
    await expect(handler(args)).rejects.toThrow(
      /Invalid arguments: include_full_text \(Expected boolean, received string\)/
    );
    await expect(handler(args)).rejects.toHaveProperty('code', ErrorCode.InvalidParams);
  });

  // Test case for the initial Zod parse failure
  it('should throw McpError if top-level argument parsing fails', async () => {
      const invalidArgs = { invalid_prop: true }; // Completely wrong structure
      await expect(handler(invalidArgs)).rejects.toThrow(McpError);
      await expect(handler(invalidArgs)).rejects.toThrow(/Invalid arguments: sources \(Required\)/); // Example Zod error
      await expect(handler(invalidArgs)).rejects.toHaveProperty('code', ErrorCode.InvalidParams);
  });


  // Updated test: Expect Zod validation to throw McpError directly
  it('should throw McpError for invalid page specification string (Zod)', async () => {
    const args = { sources: [{ path: 'test.pdf', pages: '1,abc,3' }] };
    await expect(handler(args)).rejects.toThrow(McpError);
    await expect(handler(args)).rejects.toThrow(
        /Invalid arguments: sources.0.pages \(Page string must contain only numbers, commas, and hyphens.\)/
    );
     await expect(handler(args)).rejects.toHaveProperty('code', ErrorCode.InvalidParams);
  });

  // Updated test: Expect Zod validation to throw McpError directly
  it('should throw McpError for invalid page specification array (non-positive - Zod)', async () => {
    const args = { sources: [{ path: 'test.pdf', pages: [1, 0, 3] }] };
     await expect(handler(args)).rejects.toThrow(McpError);
    await expect(handler(args)).rejects.toThrow(
      /Invalid arguments: sources.0.pages.1 \(Number must be greater than 0\)/
    );
    await expect(handler(args)).rejects.toHaveProperty('code', ErrorCode.InvalidParams);
  });

  // Test case for resolvePath failure within the catch block
  it('should return error if resolvePath fails', async () => {
      const resolveError = new Error("Mock resolvePath failed");
      vi.spyOn(pathUtils, 'resolvePath').mockImplementation(() => { throw resolveError; });
      const args = { sources: [{ path: 'some/path' }] };
      const result = await handler(args);
      // Add check for content existence and access safely, disable ESLint rule
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (result.content?.[0]) {
          const parsedResult = JSON.parse(result.content[0].text) as ExpectedResultType;
          expect(parsedResult.results[0]).toBeDefined();
          if (parsedResult.results[0]) {
              expect(parsedResult.results[0].success).toBe(false);
              expect(parsedResult.results[0].error).toBe(`Failed to process PDF from 'some/path'. Reason: ${resolveError.message}`);
          }
      } else {
          expect.fail('result.content[0] was undefined');
      }
  });

   // Test case for the final catch block with a generic error
  it('should handle generic errors during processing', async () => {
      const genericError = new Error("Something unexpected happened");
      mockReadFile.mockRejectedValue(genericError); // Simulate error after path resolution
      const args = { sources: [{ path: 'generic/error/path' }] };
      const result = await handler(args);
      // Add check for content existence and access safely, disable ESLint rule
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (result.content?.[0]) {
          const parsedResult = JSON.parse(result.content[0].text) as ExpectedResultType;
          expect(parsedResult.results[0]).toBeDefined();
          if (parsedResult.results[0]) {
              expect(parsedResult.results[0].success).toBe(false);
              expect(parsedResult.results[0].error).toBe(`Failed to process PDF from 'generic/error/path'. Reason: ${genericError.message}`);
          }
      } else {
          expect.fail('result.content[0] was undefined');
      }
  });

   // Test case for the final catch block with a non-Error object
  it('should handle non-Error exceptions during processing', async () => {
      const nonError = { message: "Just an object", code: "UNEXPECTED" };
      mockReadFile.mockRejectedValue(nonError); // Simulate error after path resolution
      const args = { sources: [{ path: 'non/error/path' }] };
      const result = await handler(args);
      // Add check for content existence and access safely, disable ESLint rule
      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (result.content?.[0]) {
          const parsedResult = JSON.parse(result.content[0].text) as ExpectedResultType;
          expect(parsedResult.results[0]).toBeDefined();
          if (parsedResult.results[0]) {
              expect(parsedResult.results[0].success).toBe(false);
              // Use JSON.stringify for non-Error objects
              expect(parsedResult.results[0].error).toBe(`Failed to process PDF from 'non/error/path'. Unknown error: ${JSON.stringify(nonError)}`);
          }
      } else {
          expect.fail('result.content[0] was undefined');
      }
  });


  it('should include warnings for requested pages exceeding total pages', async () => {
    const args = {
      sources: [{ path: 'test.pdf', pages: [1, 4, 5] }],
      include_page_count: true,
    };
    const result = await handler(args);
    const expectedData = {
      results: [
        {
          source: 'test.pdf',
          success: true,
          data: {
            info: { PDFFormatVersion: '1.7', Title: 'Mock PDF' },
            metadata: { 'dc:format': 'application/pdf' },
            num_pages: 3,
            page_texts: [{ page: 1, text: 'Mock page text 1' }],
            warnings: ['Requested page numbers 4, 5 exceed total pages (3).'],
          },
        },
      ],
    };
    expect(mockGetPage).toHaveBeenCalledTimes(1);
    expect(mockGetPage).toHaveBeenCalledWith(1);
    // Add check for content existence and access safely, disable ESLint rule
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        expect(JSON.parse(result.content[0].text) as ExpectedResultType).toEqual(expectedData);
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

  it('should handle errors during page processing gracefully when specific pages are requested', async () => {
    // eslint-disable-next-line @typescript-eslint/require-await
    mockGetPage.mockImplementation(async (pageNum: number) => {
      if (pageNum === 1)
        return {
          getTextContent: vi.fn().mockResolvedValueOnce({ items: [{ str: `Mock page text 1` }] }),
        };
      if (pageNum === 2) throw new Error('Failed to get page 2');
      if (pageNum === 3)
        return {
          getTextContent: vi.fn().mockResolvedValueOnce({ items: [{ str: `Mock page text 3` }] }),
        };
      throw new Error(`Mock getPage error: Invalid page number ${String(pageNum)}`);
    });
    const args = {
      sources: [{ path: 'test.pdf', pages: [1, 2, 3] }],
    };
    const result = await handler(args);
    const expectedData = {
      results: [
        {
          source: 'test.pdf',
          success: true,
          data: {
            info: { PDFFormatVersion: '1.7', Title: 'Mock PDF' },
            metadata: { 'dc:format': 'application/pdf' },
            num_pages: 3,
            page_texts: [
              { page: 1, text: 'Mock page text 1' },
              { page: 2, text: 'Error processing page: Failed to get page 2' },
              { page: 3, text: 'Mock page text 3' },
            ],
          },
        },
      ],
    };
    expect(mockGetPage).toHaveBeenCalledTimes(3);
    // Add check for content existence and access safely, disable ESLint rule
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        expect(JSON.parse(result.content[0].text) as ExpectedResultType).toEqual(expectedData);
    } else {
        expect.fail('result.content[0] was undefined');


  it('should return error if pdfjs fails to load document from URL', async () => {
    const testUrl = 'http://example.com/bad-url.pdf';
    const loadError = new Error('Mock URL PDF loading failed');
    const failingLoadingTask = { promise: Promise.reject(loadError) };
    // Ensure getDocument is mocked specifically for this URL
    mockGetDocument.mockReset(); // Reset previous mocks if necessary
    mockGetDocument.mockImplementation((source) => {
        if (typeof source === 'object' && source.url === testUrl) {
            return failingLoadingTask;
        }
        // Fallback for other potential calls in the test suite
        const mockDocumentAPI = { numPages: 1, getMetadata: vi.fn(), getPage: vi.fn() };
        return { promise: Promise.resolve(mockDocumentAPI) };
    });

    const args = { sources: [{ url: testUrl }] };
    const result = await handler(args);

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        const parsedResult = JSON.parse(result.content[0].text) as ExpectedResultType;
        expect(parsedResult.results[0]).toBeDefined();
        if (parsedResult.results[0]) {
            expect(parsedResult.results[0].source).toBe(testUrl); // Check source description (line 168)
            expect(parsedResult.results[0].success).toBe(false);
            expect(parsedResult.results[0].error).toBe(
              `MCP error -32600: Failed to load PDF document. Reason: ${loadError.message}`
            );
        }
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

    }
  });


  // --- Additional Error Coverage Tests ---

  it('should return error for invalid page range string (e.g., 5-3)', async () => {
    const args = { sources: [{ path: 'test.pdf', pages: '1,5-3,7' }] };
    const result = await handler(args); // Expect promise to resolve
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (result.content?.[0]) {
        const parsedResult = JSON.parse(result.content[0].text) as ExpectedResultType;
        expect(parsedResult.results[0]).toBeDefined();
        if (parsedResult.results[0]) {
            expect(parsedResult.results[0].success).toBe(false);
            expect(parsedResult.results[0].error).toMatch(
              /Invalid page specification for source 'test.pdf': Invalid page range: 5-3/
            );
            // Check the error code embedded in the message if needed, or just the message content
        }
    } else {
        expect.fail('result.content[0] was undefined');
    }
  });

  it('should throw McpError for invalid page number string (e.g., 1,a,3)', async () => {
    const args = { sources: [{ path: 'test.pdf', pages: '1,a,3' }] };
    // Zod catches this first due to refine
    await expect(handler(args)).rejects.toThrow(McpError);
     await expect(handler(args)).rejects.toThrow(
        // Escaped backslash for JSON
        /Invalid arguments: sources.0.pages \(Page string must contain only numbers, commas, and hyphens.\)/
    );
    await expect(handler(args)).rejects.toHaveProperty('code', ErrorCode.InvalidParams);
  });

  // Test Zod refinement for path/url exclusivity
  it('should throw McpError if source has both path and url', async () => {
    const args = { sources: [{ path: 'test.pdf', url: 'http://example.com' }] };
    await expect(handler(args)).rejects.toThrow(McpError);
    await expect(handler(args)).rejects.toThrow(
      // Escaped backslash for JSON
      /Invalid arguments: sources.0 \(Each source must have either 'path' or 'url', but not both.\)/
    );
    await expect(handler(args)).rejects.toHaveProperty('code', ErrorCode.InvalidParams);
  });

  it('should throw McpError if source has neither path nor url', async () => {
    const args = { sources: [{ pages: [1] }] }; // Missing path and url
    await expect(handler(args)).rejects.toThrow(McpError);
    await expect(handler(args)).rejects.toThrow(
      // Escaped backslash for JSON
      /Invalid arguments: sources.0 \(Each source must have either 'path' or 'url', but not both.\)/
    );
     await expect(handler(args)).rejects.toHaveProperty('code', ErrorCode.InvalidParams);
  });

}); // End top-level describe
