import json, re
from datetime import datetime
from openai import OpenAI

MOTIF_MODEL = "gemini-flash-lite-latest"

def _motif_text(system, user, format_json=False, timeout=120, max_tokens=2000, provider='gemini'):
    try:
        from flask import current_app
        if provider == 'groq':
            key = current_app.config.get("GROQ_API_KEY", "")
            base_url = current_app.config.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
            model = current_app.config.get("GROQ_MODEL", "openai/gpt-oss-120b")
        else:
            key = current_app.config.get("MOTIF_API_KEY", "")
            base_url = current_app.config.get("MOTIF_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
            model = MOTIF_MODEL
        client = OpenAI(api_key=key, base_url=base_url)
        kwargs = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user}
            ],
            "timeout": timeout,
            "max_tokens": max_tokens,
        }
        if format_json:
            kwargs["response_format"] = {"type": "json_object"}
        resp = client.chat.completions.create(**kwargs)
        content = resp.choices[0].message.content or ""
        if format_json:
            t = content.strip()
            if t.startswith("```"):
                t = t.split("\n", 1)[1] if "\n" in t else t[3:]
                if t.endswith("```"):
                    t = t[:-3]
                t = t.strip()
                if t.startswith("json"):
                    t = t[4:].strip()
            while "<think>" in t and "</think>" in t:
                s = t.find("<think>"); e = t.find("</think>") + len("</think>"); t = (t[:s] + t[e:]).strip()
            return json.loads(t)
        while "<think>" in content and "</think>" in content:
            s = content.find("<think>"); e = content.find("</think>") + len("</think>"); content = (content[:s] + content[e:]).strip()
        return content
    except Exception as e:
        print(f"[NewsService] Motif 오류: {e}")
        return {} if format_json else None

def ai_search_news(news_type='world', trending_context='', labor_only=False):
    trending_note = ""
    if trending_context:
        trending_note = f"\n참고: 최근 회원들이 많이 추천한 인기 카테고리는 '{trending_context}'입니다. 이 주제들을 우선 고려하되, 항상 실제 존재하는 최신 뉴스만 제안하세요."
    if labor_only:
        system = "당신은 경기 양평군민을 위한 노사/노동 뉴스 큐레이터입니다. 반드시 실제 존재하는 최근 노동법률, 임금체불, 부당해고, 산업재해, 노사관계 관련 뉴스 주제만 제안하세요. 대한민국과 전 세계 모두 포함합니다. 절대 가짜를 만들지 마세요."
        prompt = f"""오늘 기준 실제 뉴스에서 찾을 수 있는, 경기 양평군민이 꼭 알아야 할 노사/노동 관련 뉴스 주제 10가지를 제안해 주세요.
대한민국 국내 뉴스와 전 세계 뉴스를 골고루 포함하세요.
각 항목은 네이버 뉴스 검색에 사용할 검색어로도 활용되므로 구체적인 키워드를 포함하세요.
{trending_note}
한국 노사/노동 주제:
- 임금체불, 최저임금, 퇴직금, 체불임금
- 부당해고, 정리해고, 직장 내 괴롭힘, 모성보호
- 산업재해, 안전보건, 중대재해처벌법
- 노동위원회, 고용노동부, 노동법 개정
- 근로계약, 시간제/기간제 근로, 특수형태근로종사자
- 노동조합, 단체교섭, 파업, 쟁의행위
전 세계 노사/노동 주제:
- Minimum wage, living wage, wage theft
- Unfair dismissal, wrongful termination, layoffs
- Workplace safety, occupational hazards
- Labor unions, collective bargaining, strikes
- Gig economy, platform workers, contractor rights
- Maternity/paternity leave, family leave
다음 JSON 배열 형식으로 출력하세요:
{{"news": [{{"title": "검색용 구체적 키워드 (예: '2026년 최저임금 인상안 확정', '미국 노동법 개정', 'ILO 산업재해 규약')", "summary": "한국어 3줄 요약", "reason": "양평군민에게 왜 중요한지 (근로자/사업주 관점에서 구체적으로)", "category": "정책정보 중 하나"}}]}}
중요: 절대 가짜 정보를 만들지 마세요. title은 네이버 뉴스 검색에 사용할 검색어이므로 실제 키워드여야 합니다. 한국과 해외를 골고루 포함하세요."""
    elif news_type == 'kr_yp':
        system = "당신은 경기 양평군민을 위한 뉴스 큐레이터입니다. 반드시 실제 존재하는 최근 대한민국 뉴스 주제만 제안하세요. 양평군민의 생활에 직접 영향을 미치는 뉴스를 우선으로 합니다. 절대 가짜를 만들지 마세요."
        prompt = f"""오늘 기준 실제 뉴스에서 찾을 수 있는, 경기 양평군민이 꼭 알아야 할 대한민국 뉴스 주제 10가지를 제안해 주세요.
각 항목은 네이버 뉴스 검색에 사용할 검색어로도 활용되므로 구체적인 키워드를 포함하세요.
{trending_note}
양평군민이 알아야 할 주제 예시:
- 경제/물가: 소비자 물가, 농산물 가격, 금리, 부동산, 세금 정책
- 정부 지원: 지원금, 보조금, 복지 혜택, 신청 방법
- 농업: 농산물 정책, 농가 지원, 태풍/가뭄 피해
- 의료/건강: 의료 정책, 건강보험, 지역 의료기관
- 교육: 학교 정책, 교육 지원, 입시
- 교통/인프라: 도로, 대중교통, SOC 사업
- 사회/복지: 노인, 아동, 장애인, 복지 정책
- 노동/고용: 고용 정책, 창업 지원, 근로 환경
다음 JSON 배열 형식으로 출력하세요:
{{"news": [{{"title": "뉴스 검색용 구체적 키워드 (예: '2026년 농산물 가격지지 정책', '경기도 청년 지원금 신청')", "summary": "한국어 3줄 요약", "reason": "양평군민에게 왜 중요한지 (구체적으로)", "category": "대한민국뉴스/양평소식/정책정보/지역소식/농업정보 중 하나"}}]}}
중요: 절대 가짜 정보를 만들지 마세요. title은 네이버 뉴스 검색에 사용할 검색어이므로 실제 키워드여야 합니다."""
    elif news_type == 'world':
        system = "You are a global news curator for Yangpyeong County residents in South Korea. Select ONLY real, recent international news that Yangpyeong residents should know about. NEVER make up fake news."
        prompt = f"""Suggest 10 WORLD NEWS topics that Yangpyeong residents should know about.
Each topic must be an actual searchable English keyword.
{trending_note}
Yangpyeong residents should know about:
- Economy/Finance: global markets, trade, tariffs, inflation, tech industry
- Environment/Climate: climate change, renewable energy, extreme weather, sustainability
- Health/Medical: global health, new treatments, WHO, pandemics
- Technology/AI: AI regulation, tech breakthroughs, cybersecurity, space
- Society/Human rights: social issues, migration, education, demographics
- Agriculture/Food: global food supply, agricultural policy, food safety
Output in JSON array format:
{{"news": [{{"title": "English search keyword for news lookup (e.g. 'EU AI regulation 2026', 'global food price crisis')", "summary": "한국어 3줄 요약 (Korean)", "reason": "양평군민 생활과 연결되는 이유를 한국어로 구체적으로 (Korean)", "category": "세계뉴스/환경뉴스/건강정보/복지정보/농업정보/관광소식 중 하나"}}]}}
CRITICAL: NEVER make up fake news or fake URLs. title must be a real English search keyword. summary and reason in Korean."""
    result = _motif_text(system, prompt, format_json=True)
    if not result:
        return []
    try:
        return result.get("news", [])
    except:
        return []

def ai_translate_and_format(title, content, source_lang="en"):
    system = f"당신은 전문 번역가입니다. {source_lang}를 한국어 격식체(모든 문장을 '~습니다/~합니다'로 끝나게 하고, 반말·구어체·방언은 절대 사용하지 않음)로 자연스럽게 번역하고, 기사 형식으로 정리해 주세요."
    prompt = f"""다음 기사를 한국어로 번역하고, 아래 JSON 형식으로 출력하세요:
{{
  "title": "번역된 제목",
  "summary": "3줄 요약",
  "content": "본문 내용 (HTML <p>태그로 감싼 문단들)"
}}
원본 제목: {title}
원본 내용: {content[:3000]}"""
    result = _motif_text(system, prompt, format_json=True, provider='groq')
    if not result:
        print(f"[NewsService] 번역 실패: {title[:50]}")
    return result

def ai_triage_pending_news(batch_limit=60):
    """수집 기사에 '양평군민이 알아야 할 대한민국 소식' 기준 AI 채점 (점수+사유).

    - 미채점(ai_score=0) 최근 7일 기사만 대상 (idempotent)
    - 결과: ai_score 부여, ai_reason 앞에 '[점수] 사유' 접기 (관리자 💡 컬럼에서 확인)
    - 게시(is_selected)는 하지 않음 — 관리자 👁️ 확정 전용
    """
    from datetime import datetime, timedelta
    from models import db, NewsArticle
    cutoff = datetime.now() - timedelta(days=7)
    pending = (NewsArticle.query
               .filter(NewsArticle.is_ai_generated == True,
                       NewsArticle.created_at >= cutoff,
                       db.or_(NewsArticle.ai_score == 0, NewsArticle.ai_score.is_(None)))
               .order_by(NewsArticle.created_at.desc())
               .limit(batch_limit).all())
    if not pending:
        return 0

    system = ("당신은 양평군민을 위한 뉴스 선별가입니다. "
              "'양평군민이 기본적으로 알아야 할 대한민국 소식'을 판단해 기사별 점수(0~100)와 사유를 냅니다.")
    import json as _json

    def _score_chunk(chunk):
        articles = [{
            "id": a.id,
            "title": a.title or "",
            "summary": (a.summary or "")[:150],
            "category": a.category or "",
        } for a in chunk]
        prompt = f"""다음 뉴스 기사들을 채점하세요. JSON으로만 답하세요.

채점 기준 (중요도 순):
1. 환경이 1순위: 환경 오염·재해·기후·생태·하천/수질 관련 → 85~100
2. 양평군민 생활 필수: 농업/임업, 대중교통, 복지, 건강·의료, 장애인, 사이버피해 예방, 지역 인구감소 해법, 물가·지원금 → 75~95
3. 국토·도로·공사·계획의 공개(오픈) 정보: 도로 건설·국토계획·공사 착공/개통/노선 변경 등 → 80~100 (매우 중요, 민감 정보)
4. 지역 행사: 다가오는(미래 날짜의) 좋은 행사 → 70~90 / 이미 지난 행사는 → 0~20
5. 광고·홍보·연예·중요도 낮은 타 지역 잡소식 → 0~30
양평이나 대한민국 주민 생활에 직접 관련되면 가산점.

각 기사마다 사유는 한국어 25자 이내. 입력된 모든 기사를 반드시 포함하세요.
기사 목록:
{_json.dumps(articles, ensure_ascii=False)}

출력 형식: {{"articles": [{{"id": 1, "score": 90, "reason": "사유"}}]}}"""
        result = _motif_text(system, prompt, format_json=True, provider='groq', max_tokens=4000)
        items = result.get("articles") if isinstance(result, dict) else None
        return items or []

    by_id = {}
    for i in range(0, len(pending), 20):  # 20건 단위 청크 (누락 방지)
        for it in _score_chunk(pending[i:i + 20]):
            try:
                by_id[int(it.get("id"))] = (int(it.get("score", 0)), str(it.get("reason", ""))[:60])
            except (TypeError, ValueError):
                continue
    if not by_id:
        print("[TRIAGE] AI 응답 없음")
        return 0
    n = 0
    for a in pending:
        r = by_id.get(a.id)
        if not r:
            continue
        score, reason = r
        score = max(0, min(100, score))
        a.ai_score = score
        base = (a.ai_reason or "").strip()
        a.ai_reason = f"[선별 {score}] {reason}" + (f" | {base}" if base else "")
        n += 1
    db.session.commit()
    print(f"[TRIAGE] AI 선별 완료: {n}건 채점 (대상 {len(pending)}건)")
    return n

def ai_summarize_url(text):
    system = "당신은 기사 요약 전문가입니다. 한국어로 답변하세요. '본문바로가기','블로그','카테고리','검색','메뉴','이웃추가','공유하기','URL복사','신고하기','폰트크기' 등 블로그 UI/네비게이션 텍스트는 전부 무시하고, 오직 기사의 핵심 본문 내용만 요약하세요."
    prompt = f"""다음 웹페이지 내용 중 기사 본문만 골라 분석하여 양평군민에게 유용한 정보인지 판단하고 아래 JSON으로 출력하세요:
{{
  "title": "실제 기사 제목 (사이트명/블로그명 말고)",
  "summary": "핵심 내용 한국어 3줄 요약 (블로그 UI/버튼/메뉴 등은 완전히 제외하고 순수 기사 내용만)",
  "category": "분야 (대한민국뉴스/양평소식/정책정보/지역소식/세계뉴스/환경뉴스/건강정보/복지정보/농업정보/관광소식 중 하나)",
  "is_useful": true/false
}}
내용: {text[:3000]}"""
    return _motif_text(system, prompt, format_json=True, provider='groq')

def clean_cjk_text(title, summary='', content=''):
    """한자/일본어를 한국어로 변환. 불가피하면 괄호에 한국어 발음 추가."""
    texts = []
    if title: texts.append(f"제목: {title}")
    if summary: texts.append(f"요약: {summary}")
    if content: texts.append(f"본문: {content}")
    if not texts:
        return title, summary, content
    combined = '\n\n'.join(texts)
    system = "당신은 한국어 전문 편집자입니다. 다음 원칙을 따라 텍스트를 수정하세요:\n1. 모든 한자(중국 한자)는 한국어로 바꾸세요. (예: 幸福→행복, 大統領→대통령)\n2. 모든 일본어는 한국어로 바꾸세요.\n3. 불가피하게 한자/일본어를 써야 한다면, 바로 뒤 괄호에 한국어 발음을 추가하세요. (예: 東京(도쿄))\n4. 결과는 자연스러운 한국어로만 작성하세요.\n5. JSON 형식으로만 출력하세요."
    prompt = f"""다음 텍스트에서 한자와 일본어를 위 원칙대로 처리해 주세요:

{combined}

JSON 형식:
{{"title": "수정된 제목", "summary": "수정된 요약", "content": "수정된 본문"}}"""
    result = _motif_text(system, prompt, format_json=True, provider='groq')
    if not result:
        return title, summary, content
    return (
        result.get('title', title),
        result.get('summary', summary),
        result.get('content', content)
    )