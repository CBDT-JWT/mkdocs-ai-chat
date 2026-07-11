from app.llm.deepseek import _clean_rewritten_query


def test_clean_rewritten_query_removes_label_and_extra_lines():
    query = _clean_rewritten_query("检索查询: Sa函数 sinc 抽样信号\n解释：忽略这一行", "什么是Sa函数？")

    assert query == "Sa函数 sinc 抽样信号"


def test_clean_rewritten_query_falls_back_on_empty_output():
    assert _clean_rewritten_query("", "戴维南等效") == "戴维南等效"
