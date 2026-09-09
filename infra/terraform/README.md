# AWS foundation bootstrap

This Terraform root creates only the restricted-data primitives that should exist before API and AI processing work begins:

- KMS customer-managed key with rotation.
- Private S3 bucket for originals, with public access blocked, enforced bucket ownership, KMS encryption, TLS-only bucket policy and versioning.
- SQS ingestion queue plus a dead-letter queue.
- Private PostgreSQL 16 RDS instance with encryption, automated backups, AWS-managed database credentials, CloudWatch logs, and production multi-AZ/deletion protection.

## Prerequisites

1. An AWS account owned by the project, not a personal/shared root account.
2. Separate AWS accounts or isolated environments for development, staging and production.
3. An existing VPC with at least two private subnets in different availability zones.
4. An API-service security group. Only this security group can reach RDS on port 5432.
5. Terraform >= 1.7 and AWS credentials using a least-privilege deploy role.
6. A remote encrypted Terraform backend with locking. Do **not** use local state for staging or production.

## Before running

Copy the example values to a local file that is not committed:

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check
terraform validate
terraform plan -out=tfplan
```

A second review is required before `terraform apply`. Production must use `environment = "production"`, `deletion_protection = true`, an approved U.S. region, and a remote state backend.

## What is deliberately not provisioned yet

- VPC and network routes: these are account-level components and must follow the AWS landing-zone design.
- API/worker compute, IAM roles and OIDC integration: provision after the service runtime and deployment account are selected.
- WAF, CloudTrail organisation trails, GuardDuty, Security Hub and backup vault: these belong in the broader AWS account/security baseline.
- Production databases or assets: require an approved account, region, tags, budgets and deployment credentials.
