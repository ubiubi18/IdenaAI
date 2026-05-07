const {callGemini, testGeminiProvider} = require('./gemini')

describe('gemini provider adapter', () => {
  test('omits maxOutputTokens in auto mode', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          candidates: [
            {
              content: {
                parts: [{text: '{"answer":"left","confidence":0.8}'}],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 4,
            totalTokenCount: 14,
          },
        },
      }),
    }

    await callGemini({
      httpClient,
      apiKey: 'test-key',
      model: 'gemini-2.0-flash',
      flip: {
        hash: 'flip-1',
      },
      prompt: 'Decide left or right',
      systemPrompt: 'system prompt',
      profile: {
        temperature: 0,
        maxOutputTokens: 0,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
    })

    expect(httpClient.post).toHaveBeenCalledTimes(1)
    expect(httpClient.post.mock.calls[0][1].systemInstruction).toStrictEqual({
      parts: [{text: 'system prompt'}],
    })
    expect(
      httpClient.post.mock.calls[0][1].generationConfig.maxOutputTokens
    ).toBeUndefined()
  })

  test('rejects unsafe provider base URLs', async () => {
    const httpClient = {
      post: jest.fn(),
    }

    await expect(
      testGeminiProvider({
        httpClient,
        apiKey: 'test-key',
        model: 'gemini-2.0-flash',
        profile: {requestTimeoutMs: 5000},
        providerConfig: {
          baseUrl: 'data:text/plain,provider',
        },
      })
    ).rejects.toThrow(
      'Provider base URL must be an http(s) URL without embedded credentials'
    )

    await expect(
      testGeminiProvider({
        httpClient,
        apiKey: 'test-key',
        model: 'gemini-2.0-flash',
        profile: {requestTimeoutMs: 5000},
        providerConfig: {
          baseUrl: 'https://user:pass@example.test',
        },
      })
    ).rejects.toThrow(
      'Provider base URL must be an http(s) URL without embedded credentials'
    )
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  test('rejects unsafe API version path segments', async () => {
    const httpClient = {
      post: jest.fn(),
    }

    await expect(
      testGeminiProvider({
        httpClient,
        apiKey: 'test-key',
        model: 'gemini-2.0-flash',
        profile: {requestTimeoutMs: 5000},
        providerConfig: {
          apiVersion: 'v1beta?key=leaked',
        },
      })
    ).rejects.toThrow('Gemini API version must be a simple path segment')
    expect(httpClient.post).not.toHaveBeenCalled()
  })
})
