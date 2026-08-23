FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app

RUN apt-get update && apt-get install -y --no-install-recommends     build-essential libpq-dev curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8005
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s   CMD curl -f http://localhost:8005/health/ || exit 1

CMD ["python", "manage.py", "runserver", "0.0.0.0:8005"]
