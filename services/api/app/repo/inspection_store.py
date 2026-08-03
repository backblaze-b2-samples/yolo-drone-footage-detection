"""B2 (S3-compatible) persistence for inspections.

All object I/O for the inspection feature lives here so boto3 stays confined to
the repo/ layer. The cached S3 client is reused from ``b2_client`` for
connection pooling. Everything is scoped under the app's own ``inspections/``
prefix; deletes are always prefix-scoped (never a bucket-wide wipe).
"""

import io
import json
import tempfile
from typing import Any, BinaryIO

from botocore.exceptions import BotoCoreError, ClientError

from app.config import settings
from app.repo.b2_client import get_s3_client
from app.repo.list_cache import invalidate as _invalidate_list_cache

INSPECTIONS_PREFIX = "inspections/"


def _bucket() -> str:
    return settings.b2_bucket_name


def put_json(key: str, obj: Any) -> None:
    """Write a JSON document to B2. Raises RuntimeError on S3 failure."""
    body = json.dumps(obj, indent=2, sort_keys=True, default=str).encode("utf-8")
    put_bytes(key, body, "application/json")


def get_json(key: str) -> Any | None:
    """Read and parse a JSON document from B2. Returns None if the key is absent."""
    client = get_s3_client()
    try:
        response = client.get_object(Bucket=_bucket(), Key=key)
        return json.loads(response["Body"].read())
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey"):
            return None
        raise RuntimeError(f"B2 get_json failed for '{key}': {e}") from e
    except BotoCoreError as e:
        raise RuntimeError(f"B2 get_json failed for '{key}': {e}") from e


def put_bytes(key: str, data: bytes, content_type: str) -> None:
    """Upload a small in-memory object. Raises RuntimeError on S3 failure."""
    client = get_s3_client()
    try:
        client.put_object(
            Bucket=_bucket(), Key=key, Body=io.BytesIO(data), ContentType=content_type
        )
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"B2 put failed for '{key}': {e}") from e
    _invalidate_list_cache()


def upload_stream(fileobj: BinaryIO, key: str, content_type: str) -> None:
    """Stream a (potentially multi-GB) source video to B2 via multipart upload.

    ``upload_fileobj`` reads the file object in chunks, so the whole video is
    never buffered in RAM — this is what makes the "large bulk ingest" headline
    real. Raises RuntimeError on S3 failure.
    """
    client = get_s3_client()
    try:
        client.upload_fileobj(
            Fileobj=fileobj,
            Bucket=_bucket(),
            Key=key,
            ExtraArgs={"ContentType": content_type},
        )
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"B2 stream upload failed for '{key}': {e}") from e
    _invalidate_list_cache()


def list_prefix(prefix: str) -> list[dict]:
    """List every object under ``prefix`` directly (not via the full-bucket
    cache). Raises RuntimeError on S3 failure."""
    client = get_s3_client()
    contents: list[dict] = []
    kwargs: dict = {"Bucket": _bucket(), "Prefix": prefix, "MaxKeys": 1000}
    try:
        while True:
            response = client.list_objects_v2(**kwargs)
            contents.extend(response.get("Contents", []))
            if not response.get("IsTruncated"):
                break
            kwargs["ContinuationToken"] = response["NextContinuationToken"]
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"B2 list failed for '{prefix}': {e}") from e
    return contents


def list_inspection_ids() -> list[str]:
    """Return the ids of every inspection (one folder per id under the prefix)."""
    client = get_s3_client()
    ids: list[str] = []
    kwargs: dict = {"Bucket": _bucket(), "Prefix": INSPECTIONS_PREFIX, "Delimiter": "/"}
    try:
        while True:
            response = client.list_objects_v2(**kwargs)
            for cp in response.get("CommonPrefixes", []):
                p = cp.get("Prefix", "")
                sub = p[len(INSPECTIONS_PREFIX) :].rstrip("/")
                if sub:
                    ids.append(sub)
            if not response.get("IsTruncated"):
                break
            kwargs["ContinuationToken"] = response["NextContinuationToken"]
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"B2 list failed for inspections: {e}") from e
    return ids


def delete_prefix(prefix: str) -> int:
    """Delete every object under ``prefix`` (batched). Returns the count deleted.

    SAFETY: callers must pass a fully-qualified ``inspections/<id>/`` prefix —
    this is never used for a bucket-wide wipe. Raises RuntimeError on failure.
    """
    if not prefix.startswith(INSPECTIONS_PREFIX) or prefix == INSPECTIONS_PREFIX:
        raise ValueError(f"refusing to delete unscoped prefix: {prefix!r}")
    client = get_s3_client()
    objects = [{"Key": obj["Key"]} for obj in list_prefix(prefix)]
    deleted = 0
    try:
        for i in range(0, len(objects), 1000):
            batch = objects[i : i + 1000]
            if not batch:
                continue
            client.delete_objects(Bucket=_bucket(), Delete={"Objects": batch})
            deleted += len(batch)
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"B2 delete failed for '{prefix}': {e}") from e
    _invalidate_list_cache()
    return deleted


def download_to_tempfile(key: str, suffix: str = "") -> str:
    """Stream an object body from B2 to a NamedTemporaryFile and return its path.

    Used to hand the source video to OpenCV, which needs a real file path. The
    caller owns the returned path and MUST delete it. Raises RuntimeError on
    S3 failure.
    """
    client = get_s3_client()
    # Not a context manager on purpose: we hand the path back to the caller,
    # who owns closing/deleting it after OpenCV is done with the file.
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)  # noqa: SIM115
    try:
        client.download_fileobj(Bucket=_bucket(), Key=key, Fileobj=tmp)
    except (ClientError, BotoCoreError) as e:
        tmp.close()
        raise RuntimeError(f"B2 download failed for '{key}': {e}") from e
    finally:
        tmp.close()
    return tmp.name


def get_presigned_get(key: str, expires_in: int = 3600) -> str:
    """Presigned GET URL for serving annotated frames / source video inline."""
    client = get_s3_client()
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": _bucket(), "Key": key},
            ExpiresIn=expires_in,
        )
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"B2 presign failed for '{key}': {e}") from e
