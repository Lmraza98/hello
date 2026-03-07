# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS ui-builder
WORKDIR /app
COPY ui/package*.json ./ui/
RUN npm --prefix ui ci
COPY ui ./ui
RUN npm --prefix ui run build

FROM python:3.11-slim AS runtime
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=ui-builder /app/ui/dist ./ui/dist

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
