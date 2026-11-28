"""Shared file storage: Cloudflare R2 when configured, a local folder otherwise.

Every file the app keeps (uploaded PDFs, their extracted figures, chat
attachments) goes through `storage` by key, e.g.
`documents/{user_id}/{document_id}/original.pdf`, so the same database works
from any machine or server once R2 is configured.
"""
import os
from collections import OrderedDict
from pathlib import Path
from typing import Optional

from starlette.concurrency import run_in_threadpool

from app.config import settings


class StorageError(Exception):
    """A file that should exist could not be read."""


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError(f"Invalid storage key: {key}")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError as exc:
            raise StorageError(key) from exc

    def delete_prefix(self, prefix: str) -> None:
        base = self._path(prefix.rstrip("/"))
        if base.is_dir():
            for path in sorted(base.rglob("*"), reverse=True):
                path.unlink() if path.is_file() else path.rmdir()
            base.rmdir()
        elif base.is_file():
            base.unlink()


class R2Storage:
    def __init__(self):
        import boto3

        self.bucket = settings.r2_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key: str) -> bytes:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.client.exceptions.NoSuchKey as exc:
            raise StorageError(key) from exc

    def delete_prefix(self, prefix: str) -> None:
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            keys = [{"Key": item["Key"]} for item in page.get("Contents", [])]
            if keys:
                self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": keys})


class Storage:
    """Async facade (R2 calls are blocking) + a small cache of recently read
    files, so e.g. the "Học" screen rendering N page images of one PDF fetches
    that PDF from R2 once, not N times."""

    CACHE_MAX_BYTES = 120 * 1024 * 1024

    def __init__(self):
        self._backend = None
        self._cache: "OrderedDict[str, bytes]" = OrderedDict()
        self._cache_bytes = 0

    @property
    def backend(self):
        if self._backend is None:
            r2_ready = all((settings.r2_account_id, settings.r2_access_key_id,
                            settings.r2_secret_access_key, settings.r2_bucket))
            self._backend = R2Storage() if r2_ready else LocalStorage(settings.local_storage_dir)
        return self._backend

    async def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        await run_in_threadpool(self.backend.put, key, data, content_type)
        self._forget(key)

    async def get(self, key: str) -> bytes:
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        data = await run_in_threadpool(self.backend.get, key)
        self._remember(key, data)
        return data

    async def try_get(self, key: str) -> Optional[bytes]:
        try:
            return await self.get(key)
        except StorageError:
            return None

    async def delete_prefix(self, prefix: str) -> None:
        await run_in_threadpool(self.backend.delete_prefix, prefix)
        for key in [k for k in self._cache if k.startswith(prefix)]:
            self._forget(key)

    def _remember(self, key: str, data: bytes) -> None:
        if len(data) > self.CACHE_MAX_BYTES // 2:
            return
        self._cache[key] = data
        self._cache_bytes += len(data)
        while self._cache_bytes > self.CACHE_MAX_BYTES:
            _, evicted = self._cache.popitem(last=False)
            self._cache_bytes -= len(evicted)

    def _forget(self, key: str) -> None:
        data = self._cache.pop(key, None)
        if data is not None:
            self._cache_bytes -= len(data)


def document_key(user_id, document_id) -> str:
    return f"documents/{user_id}/{document_id}/original.pdf"


def document_prefix(user_id, document_id) -> str:
    return f"documents/{user_id}/{document_id}/"


def figure_key(user_id, document_id, filename: str) -> str:
    return f"documents/{user_id}/{document_id}/figures/{os.path.basename(filename)}"


def chat_attachment_key(user_id, attachment_id) -> str:
    return f"chat/{user_id}/{attachment_id}"


storage = Storage()
