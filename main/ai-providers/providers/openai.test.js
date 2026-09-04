const {
  callOpenAi,
  callOpenAiImage,
  testOpenAiFastMode,
  testOpenAiProvider,
} = require('./openai')
const {STORY_OPTIONS_OPENAI_RESPONSE_FORMAT} = require('../storySchema')

function makeUnsupportedParameterError(param, message = '') {
  return {
    response: {
      status: 400,
      data: {
        error: {
          type: 'unsupported_parameter',
          code: 'unsupported_parameter',
          param,
          message:
            message ||
            `Unsupported parameter: '${param}' is not supported for this model.`,
        },
      },
    },
  }
}

describe('openai provider adapter', () => {
  test.each(['none', 'minimal', 'low', 'high'])(
    'normalizes Astra %s reasoning without unsupported sampling parameters',
    async (reasoningEffort) => {
      const httpClient = {
        post: jest.fn().mockResolvedValue({
          data: {choices: [{message: {content: '{"answer":"left"}'}}]},
        }),
      }
      await callOpenAi({
        httpClient,
        apiKey: 'test-key',
        model: 'gpt-6-astra',
        flip: {leftImage: 'data:image/png;base64,AAA'},
        prompt: 'Choose the coherent sequence.',
        profile: {temperature: 0, maxOutputTokens: 512, requestTimeoutMs: 5000},
        promptOptions: {
          openAiReasoningEffort: reasoningEffort,
          structuredOutput: {
            responseFormat: STORY_OPTIONS_OPENAI_RESPONSE_FORMAT,
          },
        },
        providerConfig: {
          extraBody: {
            temperature: 1,
            top_p: 0.9,
            top_logprobs: 2,
            logprobs: true,
            prompt_cache_retention: '24h',
            max_tokens: 999999,
          },
        },
      })
      expect(httpClient.post).toHaveBeenCalledTimes(1)
      const payload = httpClient.post.mock.calls[0][1]
      expect(payload).toMatchObject({
        model: 'gpt-6-astra',
        max_completion_tokens: 512,
        reasoning_effort: reasoningEffort === 'high' ? 'high' : 'low',
        response_format: STORY_OPTIONS_OPENAI_RESPONSE_FORMAT,
        prompt_cache_options: {ttl: '30m'},
      })
      for (const field of [
        'temperature',
        'top_p',
        'top_logprobs',
        'logprobs',
        'max_tokens',
        'prompt_cache_retention',
      ]) {
        expect(payload).not.toHaveProperty(field)
      }
      expect(payload.messages[0].content[1]).toEqual({
        type: 'image_url',
        image_url: {url: 'data:image/png;base64,AAA'},
      })
    }
  )

  test('keeps Astra output bounded through compatibility retries', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockRejectedValue(makeUnsupportedParameterError('response_format')),
    }
    await expect(
      callOpenAi({
        httpClient,
        apiKey: 'test-key',
        model: 'gpt-6-astra',
        prompt: 'Return JSON.',
        profile: {maxOutputTokens: 512, requestTimeoutMs: 5000},
        promptOptions: {
          structuredOutput: {
            responseFormat: STORY_OPTIONS_OPENAI_RESPONSE_FORMAT,
          },
        },
      })
    ).rejects.toBeDefined()
    expect(httpClient.post.mock.calls.length).toBeGreaterThan(1)
    for (const [, payload] of httpClient.post.mock.calls) {
      expect(payload.max_completion_tokens).toBe(512)
      expect(payload.reasoning_effort).toBe('low')
    }
  })

  test('uses the default tier for Astra on the EU endpoint', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {choices: [{message: {content: 'ok'}}], service_tier: 'default'},
      }),
    }
    const result = await testOpenAiFastMode({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-6-astra',
      providerConfig: {baseUrl: 'https://eu.api.openai.com/v1'},
    })
    expect(httpClient.post.mock.calls[0][1]).toMatchObject({
      model: 'gpt-6-astra',
      max_completion_tokens: 256,
      reasoning_effort: 'low',
      service_tier: 'default',
    })
    expect(result.priorityDowngraded).toBe(true)
  })

  test('falls back from max_tokens to max_completion_tokens', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockRejectedValueOnce(makeUnsupportedParameterError('max_tokens'))
        .mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content: '{"answer":"left","confidence":0.91}',
                },
              },
            ],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 15,
              total_tokens: 135,
            },
          },
        }),
    }

    const result = await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      flip: {
        hash: 'flip-1',
        leftImage: 'data:image/png;base64,AAA',
        rightImage: 'data:image/png;base64,BBB',
      },
      prompt: 'test prompt',
      profile: {
        temperature: 0,
        maxOutputTokens: 100,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
    })

    expect(httpClient.post).toHaveBeenCalledTimes(2)
    expect(httpClient.post.mock.calls[0][1].max_tokens).toBe(100)
    expect(
      httpClient.post.mock.calls[0][1].max_completion_tokens
    ).toBeUndefined()
    expect(httpClient.post.mock.calls[1][1].max_tokens).toBeUndefined()
    expect(httpClient.post.mock.calls[1][1].max_completion_tokens).toBe(100)
    expect(result.rawText).toContain('"answer":"left"')
    expect(result.usage.totalTokens).toBe(135)
  })

  test('adds provider extra body fields without overriding core chat payload', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: '{"answer":"right","confidence":0.9}',
              },
            },
          ],
        },
      }),
    }

    await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'Qwen/Qwen3.6-35B-A3B',
      flip: {
        hash: 'flip-extra-body',
        leftImage: 'data:image/png;base64,AAA',
        rightImage: 'data:image/png;base64,BBB',
      },
      prompt: 'test prompt',
      profile: {
        temperature: 0,
        maxOutputTokens: 100,
        requestTimeoutMs: 5000,
      },
      providerConfig: {
        extraBody: {
          chat_template_kwargs: {
            enable_thinking: false,
          },
          model: 'attacker-model',
          messages: [],
        },
      },
    })

    expect(httpClient.post).toHaveBeenCalledTimes(1)
    const payload = httpClient.post.mock.calls[0][1]
    expect(payload.model).toBe('Qwen/Qwen3.6-35B-A3B')
    expect(payload.messages).toHaveLength(1)
    expect(payload.chat_template_kwargs).toEqual({
      enable_thinking: false,
    })
  })

  test('uses reasoning_content when provider returns empty content', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: '',
                reasoning_content: '{"answer":"left","confidence":0.88}',
              },
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 90,
            total_tokens: 210,
          },
        },
      }),
    }

    const result = await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'Qwen/Qwen3.6-35B-A3B',
      flip: {
        hash: 'flip-reasoning-content',
        leftImage: 'data:image/png;base64,AAA',
        rightImage: 'data:image/png;base64,BBB',
      },
      prompt: 'test prompt',
      profile: {
        temperature: 0,
        maxOutputTokens: 100,
        requestTimeoutMs: 5000,
      },
      providerConfig: {
        extraBody: {
          chat_template_kwargs: {
            enable_thinking: true,
          },
        },
      },
    })

    expect(result.rawText).toBe('{"answer":"left","confidence":0.88}')
    expect(result.usage.totalTokens).toBe(210)
  })

  test('rejects unsafe provider base URLs', async () => {
    const httpClient = {
      post: jest.fn(),
    }

    await expect(
      testOpenAiProvider({
        httpClient,
        apiKey: 'test-key',
        model: 'gpt-4.1-mini',
        profile: {requestTimeoutMs: 5000},
        providerConfig: {
          baseUrl: 'file:///tmp/provider',
        },
      })
    ).rejects.toThrow(
      'Provider base URL must be an http(s) URL without embedded credentials'
    )

    await expect(
      testOpenAiProvider({
        httpClient,
        apiKey: 'test-key',
        model: 'gpt-4.1-mini',
        profile: {requestTimeoutMs: 5000},
        providerConfig: {
          baseUrl: 'https://user:pass@example.test/v1',
        },
      })
    ).rejects.toThrow(
      'Provider base URL must be an http(s) URL without embedded credentials'
    )
    expect(httpClient.post).not.toHaveBeenCalled()
  })

  test('does not let extra headers override provider auth headers', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({data: {choices: []}}),
    }

    await testOpenAiProvider({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      profile: {requestTimeoutMs: 5000},
      providerConfig: {
        baseUrl: 'https://example.test/v1',
        authHeader: 'X-API-Key',
        authPrefix: '',
        extraHeaders: {
          Authorization: 'Bearer attacker',
          'X-API-Key': 'attacker',
          'X-Title': 'IdenaAI',
          'Bad Header': 'bad',
        },
      },
    })

    expect(httpClient.post).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.any(Object),
      expect.objectContaining({
        headers: {
          'X-API-Key': 'test-key',
          'X-Title': 'IdenaAI',
        },
      })
    )
  })

  test('strips query and fragment components from provider endpoints', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({data: {choices: []}}),
    }

    await testOpenAiProvider({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      profile: {requestTimeoutMs: 5000},
      providerConfig: {
        baseUrl: 'https://example.test/v1?key=leaked#fragment',
        chatPath: 'chat/completions?api_key=leaked#fragment',
      },
    })

    expect(httpClient.post.mock.calls[0][0]).toBe(
      'https://example.test/v1/chat/completions'
    )
  })

  test('removes response_format and temperature when unsupported', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockRejectedValueOnce(makeUnsupportedParameterError('response_format'))
        .mockRejectedValueOnce(makeUnsupportedParameterError('temperature'))
        .mockRejectedValueOnce(makeUnsupportedParameterError('temperature'))
        .mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content: '{"answer":"right","confidence":0.7}',
                },
              },
            ],
            usage: {
              prompt_tokens: 80,
              completion_tokens: 20,
              total_tokens: 100,
            },
          },
        }),
    }

    await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'o3',
      flip: {
        hash: 'flip-2',
        leftImage: 'data:image/png;base64,AAA',
        rightImage: 'data:image/png;base64,BBB',
      },
      prompt: 'test prompt',
      profile: {
        temperature: 0.2,
        maxOutputTokens: 128,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
    })

    expect(httpClient.post).toHaveBeenCalledTimes(4)
    expect(httpClient.post.mock.calls[2][1].response_format).toBeUndefined()
    expect(httpClient.post.mock.calls[2][1].temperature).toBe(0.2)
    expect(httpClient.post.mock.calls[3][1].response_format).toBeUndefined()
    expect(httpClient.post.mock.calls[3][1].temperature).toBeUndefined()
  })

  test('omits temperature when provider config requires provider defaults', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: '{"answer":"left","confidence":0.82}',
              },
            },
          ],
        },
      }),
    }

    await callOpenAi({
      httpClient,
      apiKey: 'moonshot-key',
      model: 'kimi-k2.6',
      flip: {
        hash: 'flip-kimi',
        leftImage: 'data:image/png;base64,AAA',
        rightImage: 'data:image/png;base64,BBB',
      },
      prompt: 'test prompt',
      profile: {
        temperature: 0,
        maxOutputTokens: 128,
        requestTimeoutMs: 5000,
      },
      providerConfig: {
        baseUrl: 'https://api.moonshot.ai/v1',
        omitTemperature: true,
      },
    })

    expect(httpClient.post).toHaveBeenCalledTimes(1)
    expect(httpClient.post.mock.calls[0][0]).toBe(
      'https://api.moonshot.ai/v1/chat/completions'
    )
    expect(httpClient.post.mock.calls[0][1]).toMatchObject({
      model: 'kimi-k2.6',
      max_tokens: 128,
    })
    expect(httpClient.post.mock.calls[0][1].temperature).toBeUndefined()
  })

  test('passes through service tier and reasoning effort when requested', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: '{"answer":"left","confidence":0.88}',
              },
            },
          ],
          usage: {
            prompt_tokens: 70,
            completion_tokens: 14,
            total_tokens: 84,
          },
        },
      }),
    }

    await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-5.4-mini',
      flip: {
        hash: 'flip-priority',
        leftImage: 'data:image/png;base64,AAA',
        rightImage: 'data:image/png;base64,BBB',
      },
      prompt: 'test prompt',
      systemPrompt: 'system prompt',
      profile: {
        temperature: 0,
        maxOutputTokens: 96,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
      promptOptions: {
        openAiServiceTier: 'priority',
        openAiReasoningEffort: 'none',
      },
    })

    expect(httpClient.post).toHaveBeenCalledTimes(1)
    expect(httpClient.post.mock.calls[0][1]).toMatchObject({
      service_tier: 'priority',
      reasoning_effort: 'none',
    })
    expect(httpClient.post.mock.calls[0][1].messages[0]).toStrictEqual({
      role: 'system',
      content: 'system prompt',
    })
  })

  test('reports fast-mode compatibility fallback when OpenAI rejects the short-session extras', async () => {
    const httpClient = {
      post: jest
        .fn()
        .mockRejectedValueOnce(makeUnsupportedParameterError('service_tier'))
        .mockRejectedValueOnce(
          makeUnsupportedParameterError('reasoning_effort')
        )
        .mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  content: '{"answer":"left","confidence":0.83}',
                },
              },
            ],
            usage: {
              prompt_tokens: 60,
              completion_tokens: 12,
              total_tokens: 72,
            },
          },
        }),
    }

    const result = await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-5.4-mini',
      flip: {
        hash: 'flip-fast-fallback',
        leftImage: 'data:image/png;base64,AAA',
        rightImage: 'data:image/png;base64,BBB',
      },
      prompt: 'test prompt',
      profile: {
        temperature: 0,
        maxOutputTokens: 96,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
      promptOptions: {
        openAiServiceTier: 'priority',
        openAiReasoningEffort: 'none',
      },
    })

    expect(httpClient.post).toHaveBeenCalledTimes(3)
    expect(result.providerMeta.fastMode).toMatchObject({
      requested: true,
      compatibilityFallbackUsed: true,
      requestedServiceTier: 'priority',
      requestedReasoningEffort: 'none',
    })
  })

  test('uses minimal payload for provider test call', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({data: {ok: true}}),
    }

    await testOpenAiProvider({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-4.1-mini',
      profile: {
        requestTimeoutMs: 4000,
      },
      providerConfig: null,
    })

    const payload = httpClient.post.mock.calls[0][1]
    expect(payload.model).toBe('gpt-4.1-mini')
    expect(Array.isArray(payload.messages)).toBe(true)
    expect(payload.temperature).toBeUndefined()
    expect(payload.max_tokens).toBeUndefined()
    expect(payload.max_completion_tokens).toBeUndefined()
    expect(payload.response_format).toBeUndefined()
  })

  test('probes the exact GPT-5.5 short-session fast request', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          service_tier: 'priority',
          choices: [{message: {content: 'ok'}}],
        },
      }),
    }

    const result = await testOpenAiFastMode({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-5.5',
      profile: {
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
    })

    expect(httpClient.post).toHaveBeenCalledTimes(1)
    expect(httpClient.post.mock.calls[0][1]).toEqual({
      model: 'gpt-5.5',
      messages: [
        {
          role: 'user',
          content: 'Reply with the single lowercase word ok.',
        },
      ],
      max_completion_tokens: 16,
      service_tier: 'priority',
      reasoning_effort: 'low',
    })
    expect(result).toEqual({
      requestedServiceTier: 'priority',
      requestedReasoningEffort: 'low',
      appliedServiceTier: 'priority',
      priorityDowngraded: false,
    })
  })

  test('passes through structured output schema and exposes provider refusal metadata', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              finish_reason: 'content_filter',
              message: {
                content: '',
                refusal: 'Policy refusal.',
              },
            },
          ],
          usage: {
            prompt_tokens: 90,
            completion_tokens: 0,
            total_tokens: 90,
          },
        },
      }),
    }

    const result = await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      flip: {
        hash: 'flip-structured-output',
      },
      prompt: 'return structured story json',
      profile: {
        temperature: 0.2,
        maxOutputTokens: 256,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
      promptOptions: {
        structuredOutput: {
          responseFormat: STORY_OPTIONS_OPENAI_RESPONSE_FORMAT,
        },
      },
    })

    expect(httpClient.post).toHaveBeenCalledTimes(1)
    expect(httpClient.post.mock.calls[0][1].response_format).toEqual(
      STORY_OPTIONS_OPENAI_RESPONSE_FORMAT
    )
    expect(result.providerMeta).toMatchObject({
      finishReason: 'content_filter',
      refusal: 'Policy refusal.',
      safetyBlock: true,
      truncated: false,
    })
  })

  test('extracts structured story json from message.parsed when content is empty', async () => {
    const parsedPayload = {
      stories: [
        {
          title: 'Option 1',
          story_summary: 'A mirror reveals a ghost and a brush falls.',
          panels: [
            {
              panel: 1,
              role: 'before',
              description: 'A person wipes a mirror.',
              required_visibles: ['person', 'mirror'],
              state_change_from_previous: 'n/a',
            },
            {
              panel: 2,
              role: 'trigger',
              description: 'A ghost appears in the mirror.',
              required_visibles: ['ghost', 'mirror'],
              state_change_from_previous: 'The ghost becomes visible.',
            },
            {
              panel: 3,
              role: 'reaction',
              description: 'A brush drops to the floor.',
              required_visibles: ['brush', 'floor'],
              state_change_from_previous: 'The brush has fallen.',
            },
            {
              panel: 4,
              role: 'after',
              description: 'The person stares at the tilted mirror.',
              required_visibles: ['person', 'mirror'],
              state_change_from_previous: 'The mirror remains tilted.',
            },
          ],
          compliance_report: {
            keyword_relevance: 'pass',
          },
          risk_flags: [],
          revision_if_risky: '',
        },
        {
          title: 'Option 2',
          story_summary: 'A window reveals a ghost and a lamp falls.',
          panels: [
            {
              panel: 1,
              role: 'before',
              description: 'A person reads beside a window.',
              required_visibles: ['person', 'window'],
              state_change_from_previous: 'n/a',
            },
            {
              panel: 2,
              role: 'trigger',
              description: 'A ghost appears outside the window.',
              required_visibles: ['ghost', 'window'],
              state_change_from_previous: 'The ghost becomes visible.',
            },
            {
              panel: 3,
              role: 'reaction',
              description: 'A lamp falls from the table.',
              required_visibles: ['lamp', 'table'],
              state_change_from_previous: 'The lamp has fallen.',
            },
            {
              panel: 4,
              role: 'after',
              description: 'The person backs away from the fallen lamp.',
              required_visibles: ['person', 'lamp'],
              state_change_from_previous: 'The person has retreated.',
            },
          ],
          compliance_report: {
            keyword_relevance: 'pass',
          },
          risk_flags: [],
          revision_if_risky: '',
        },
      ],
    }
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: '',
                parsed: parsedPayload,
              },
            },
          ],
          usage: {
            prompt_tokens: 90,
            completion_tokens: 40,
            total_tokens: 130,
          },
        },
      }),
    }

    const result = await callOpenAi({
      httpClient,
      apiKey: 'test-key',
      model: 'gpt-4o-mini',
      flip: {
        hash: 'flip-structured-parsed',
      },
      prompt: 'return structured story json',
      profile: {
        temperature: 0.2,
        maxOutputTokens: 256,
        requestTimeoutMs: 5000,
      },
      providerConfig: null,
      promptOptions: {
        structuredOutput: {
          responseFormat: STORY_OPTIONS_OPENAI_RESPONSE_FORMAT,
        },
      },
    })

    expect(result.rawText).toBe(JSON.stringify(parsedPayload))
    expect(result.providerMeta).toMatchObject({
      finishReason: 'stop',
      refusal: '',
      safetyBlock: false,
      truncated: false,
    })
  })

  test('bounds generated-image URL downloads and requires image content', async () => {
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        data: {data: [{url: 'https://images.example.test/result'}]},
      }),
      get: jest.fn().mockResolvedValue({
        data: Buffer.from('not an image'),
        headers: {'content-type': 'text/html'},
      }),
    }

    await expect(
      callOpenAiImage({
        httpClient,
        apiKey: 'test-key',
        model: 'gpt-image-1-mini',
        prompt: 'test image',
        profile: {requestTimeoutMs: 5000},
      })
    ).rejects.toThrow(/non-image payload/u)
    expect(httpClient.get).toHaveBeenCalledWith(
      'https://images.example.test/result',
      expect.objectContaining({
        redirect: 'error',
        maxResponseBytes: 20 * 1024 * 1024,
      })
    )
  })
})
