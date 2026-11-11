import os
import sentry_sdk

sentry_sdk.init(dsn=os.environ.get("SENTRY_DSN"))

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ["POSTGRES_DB"],
    }
}
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL")
AWS_STORAGE_BUCKET_NAME = os.environ.get("AWS_STORAGE_BUCKET_NAME")
