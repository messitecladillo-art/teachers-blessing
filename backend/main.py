"""EduForge Studio FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.bootstrap import ensure_showcase_data
from core.database import init_db
from routers import agent, analytics, artifacts, courses, exam, lesson, mindmap, pedagogy, ppt, sources, system, tutor


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    ensure_showcase_data()
    yield


app = FastAPI(
    title="知学工作台 API",
    version="1.0.0",
    description="面向教学备课与自主学习的智能工作台后端服务",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(courses.router)
app.include_router(agent.router)
app.include_router(tutor.router)
app.include_router(lesson.router)
app.include_router(ppt.router)
app.include_router(exam.router)
app.include_router(analytics.router)
app.include_router(sources.router)
app.include_router(artifacts.router)
app.include_router(pedagogy.router)
app.include_router(mindmap.router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "healthy"}
