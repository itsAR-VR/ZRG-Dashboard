FROM python:3.12-slim

# Install Playwright/Chromium system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates fonts-liberation libasound2 \
    libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcups2 \
    libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 \
    libxrandr2 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers (Crawl4AI uses Playwright internally)
RUN crawl4ai-setup

# Copy service code
COPY service.py .

EXPOSE 4891
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "4891"]
