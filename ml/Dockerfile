FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

WORKDIR /app

# LightGBM loads libgomp at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-serve.txt ./
RUN pip install --no-cache-dir -r requirements-serve.txt

COPY serve.py ./
COPY artifacts ./artifacts

EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn serve:app --host 0.0.0.0 --port ${PORT}"]
