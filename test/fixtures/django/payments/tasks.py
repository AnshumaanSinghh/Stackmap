import stripe
import boto3
from shop.celery import app


@app.task
def charge(customer_id):
    s3 = boto3.client("s3")
    return stripe.PaymentIntent.create(customer=customer_id, amount=100, currency="usd"), s3
