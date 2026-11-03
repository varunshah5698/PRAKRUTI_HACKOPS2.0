FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt requirements-serve.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-serve.txt
COPY serve.py ./
COPY artifacts ./artifacts
EXPOSE 8000
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "8000"]
