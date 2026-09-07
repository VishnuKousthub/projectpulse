# ==========================================
# ProjectPulse - Production Dockerfile
# ==========================================

# 1. Base Image: Lightweight Python 3.11
FROM python:3.11-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PROJECT_PULSE_DB=/app/data/project_pulse.db \
    PORT=8080 \
    DOCKER=1

# Working Directory
WORKDIR /app

# Install system utilities if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python Dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Application Code
COPY app/ /app/app/
COPY static/ /app/static/

# Create data directory for persistent SQLite storage
RUN mkdir -p /app/data && chmod 777 /app/data

# Expose Web Port (8080 for Cloud Run, 8000 for local/docker-compose)
EXPOSE 8080 8000

# Start Production WSGI Server (Gunicorn with exec for instant signal & port binding)
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-8080} --workers 1 --threads 8 --timeout 120 app.main:app"]
