import os
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel


app = FastAPI(title="Crawl4AI Extract Service")


class ExtractRequest(BaseModel):
    url: str


@app.post("/extract")
async def extract(req: ExtractRequest, authorization: str | None = Header(default=None)):
    secret = os.environ.get("CRAWL4AI_SERVICE_SECRET")
    if secret:
        expected = f"Bearer {secret}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="Unauthorized")

    parsed = urlparse(req.url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http(s) URLs are supported")

    try:
        from crawl4ai import AsyncWebCrawler
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"crawl4ai not available: {exc}") from exc

    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=req.url)

    markdown = getattr(result, "markdown", "") or ""
    return {"markdown": markdown}

