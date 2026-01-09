import argparse
import asyncio
import json
import sys


async def crawl(url: str) -> str:
    from crawl4ai import AsyncWebCrawler  # lazy import for clearer errors if not installed

    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url)
        return getattr(result, "markdown", "") or ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract markdown from a URL using crawl4ai.")
    parser.add_argument("url", help="The URL to crawl")
    args = parser.parse_args()

    try:
        markdown = asyncio.run(crawl(args.url))
    except Exception as exc:
        json.dump({"success": False, "error": str(exc)}, sys.stdout)
        return 1

    json.dump({"success": True, "url": args.url, "markdown": markdown}, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

