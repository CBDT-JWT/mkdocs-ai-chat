import copy

from app.llm.deepseek import DeepSeekClient, _clean_rewritten_query, _parse_search_arguments


def test_clean_rewritten_query_removes_label_and_extra_lines():
    query = _clean_rewritten_query("检索查询: Sa函数 sinc 抽样信号\n解释：忽略这一行", "什么是Sa函数？")

    assert query == "Sa函数 sinc 抽样信号"


def test_clean_rewritten_query_falls_back_on_empty_output():
    assert _clean_rewritten_query("", "戴维南等效") == "戴维南等效"


def test_agent_can_answer_without_search(monkeypatch):
    client = DeepSeekClient("test", "https://api.example.com", "deepseek-v4-flash")

    def fake_stream(_messages, *, tools):
        assert tools is not None
        yield {"choices": [{"delta": {"reasoning_content": "No search is needed."}}]}
        yield {"choices": [{"delta": {"content": "你好，直接回答。"}}]}

    monkeypatch.setattr(client, "_stream_chat", fake_stream)

    def unexpected_search(_query, _limit):
        raise AssertionError("search_docs should not be called")

    events = list(client.agent_events("你好", [], unexpected_search))

    assert [event["type"] for event in events] == ["thinking", "delta", "sources", "done"]
    assert "".join(event.get("content", "") for event in events) == "你好，直接回答。"


def test_agent_can_search_multiple_times_then_stream_answer(monkeypatch):
    client = DeepSeekClient("test", "https://api.example.com", "deepseek-v4-flash")
    turns = iter(
        [
            [
                {
                    "choices": [
                        {
                            "delta": {
                                "reasoning_content": "Search for the definition.",
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call-1",
                                        "type": "function",
                                        "function": {"name": "search_docs", "arguments": '{"query":"Sa'},
                                    }
                                ],
                            }
                        }
                    ]
                },
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "function": {"arguments": '函数","limit":3}'},
                                    }
                                ]
                            }
                        }
                    ]
                },
            ],
            [
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call-2",
                                        "type": "function",
                                        "function": {
                                            "name": "search_docs",
                                            "arguments": '{"query":"sinc 抽样定理","limit":2}',
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                }
            ],
            [
                {"choices": [{"delta": {"content": "Sa 函数定义为 "}}]},
                {"choices": [{"delta": {"content": "$\\sin t/t$。"}}]},
            ],
        ]
    )
    message_snapshots = []

    def fake_stream(messages, *, tools):
        message_snapshots.append(copy.deepcopy(messages))
        yield from next(turns)

    monkeypatch.setattr(client, "_stream_chat", fake_stream)
    searches = []

    def search(query, limit):
        searches.append((query, limit))
        return {
            "count": 1,
            "results": [{"heading": query, "content": "document result"}],
            "sources": [{"title": query, "url": f"https://example.com/{len(searches)}", "source": "notes.md"}],
        }

    events = list(client.agent_events("解释 Sa 函数及其在抽样中的作用", [], search))

    assert searches == [("Sa函数", 3), ("sinc 抽样定理", 2)]
    assert "".join(event.get("content", "") for event in events) == "Sa 函数定义为 $\\sin t/t$。"
    assert [event["type"] for event in events].count("tool_call") == 2
    assert [event["type"] for event in events].count("tool_result") == 2
    assert [source["url"] for source in events[-2]["sources"]] == [
        "https://example.com/1",
        "https://example.com/2",
    ]
    assert message_snapshots[1][-2]["reasoning_content"] == "Search for the definition."
    assert message_snapshots[1][-1]["role"] == "tool"
    assert message_snapshots[2][-1]["tool_call_id"] == "call-2"


def test_parse_search_arguments_validates_and_clamps_limit():
    assert _parse_search_arguments('{"query":"  UART RX  ","limit":99}') == ("UART RX", 8, None)
    assert _parse_search_arguments("not-json")[2] == "tool arguments must be valid JSON"


def test_stream_chat_explicitly_configures_v4_thinking(monkeypatch):
    requests = []

    class FakeResponse:
        encoding = ""

        def raise_for_status(self):
            return None

        def iter_lines(self, decode_unicode=False):
            assert decode_unicode is True
            return iter(["data: [DONE]"])

    def fake_post(_url, **kwargs):
        requests.append(kwargs["json"])
        assert kwargs["stream"] is True
        return FakeResponse()

    monkeypatch.setattr("app.llm.deepseek.requests.post", fake_post)

    enabled = DeepSeekClient("test", "https://api.example.com", "deepseek-v4-flash")
    disabled = DeepSeekClient(
        "test",
        "https://api.example.com",
        "deepseek-v4-flash",
        thinking_enabled=False,
    )

    list(enabled._stream_chat([{"role": "user", "content": "test"}], tools=[]))
    list(disabled._stream_chat([{"role": "user", "content": "test"}], tools=[]))

    assert requests[0]["thinking"] == {"type": "enabled"}
    assert requests[0]["reasoning_effort"] == "high"
    assert requests[1]["thinking"] == {"type": "disabled"}
    assert "reasoning_effort" not in requests[1]
