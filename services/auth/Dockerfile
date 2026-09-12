FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app

RUN apt-get update && apt-get install -y --no-install-recommends     build-essential libpq-dev curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s   CMD curl -f http://localhost:8001/health/ || exit 1

# "sh" explicito: el bind mount desde Windows no garantiza el bit de ejecucion
ENTRYPOINT ["sh", "entrypoint.sh"]
CMD ["python", "manage.py", "runserver", "0.0.0.0:8001"]
