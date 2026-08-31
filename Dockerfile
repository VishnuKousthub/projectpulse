# ==========================================
# ProjectPulse - Production Dockerfile
# ==========================================

# 1. Base Image: Lightweight Python 3.11
FROM python:3.11-slim AS base

# Prevent Python from writing .pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PROJECT_PULSE_DB=/app/data/project_pulse.db \
    PORT=8000 \
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

# Expose Web Port
EXPOSE 8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/api/projects || exit 1

# Start Production WSGI Server (Gunicorn with 2 workers + 4 threads)
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "120", "app.main:app"]
