locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

resource "aws_kms_key" "restricted_data" {
  description             = "Envelope-encryption root key for ${local.name_prefix} restricted data"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name = "${local.name_prefix}-restricted-data"
  }
}

resource "aws_kms_alias" "restricted_data" {
  name          = "alias/${local.name_prefix}-restricted-data"
  target_key_id = aws_kms_key.restricted_data.key_id
}

resource "aws_s3_bucket" "private_assets" {
  bucket        = "${local.name_prefix}-private-assets"
  force_destroy = var.force_destroy_object_storage
}

resource "aws_s3_bucket_public_access_block" "private_assets" {
  bucket                  = aws_s3_bucket.private_assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "private_assets" {
  bucket = aws_s3_bucket.private_assets.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "private_assets" {
  bucket = aws_s3_bucket.private_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.restricted_data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "private_assets" {
  bucket = aws_s3_bucket.private_assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "private_assets" {
  bucket = aws_s3_bucket.private_assets.id

  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "private_assets_tls_only" {
  bucket = aws_s3_bucket.private_assets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.private_assets.arn,
        "${aws_s3_bucket.private_assets.arn}/*"
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}

resource "aws_sqs_queue" "ingestion_dlq" {
  name                      = "${local.name_prefix}-ingestion-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "ingestion" {
  name                       = "${local.name_prefix}-ingestion"
  visibility_timeout_seconds = 900
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingestion_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_security_group" "postgres" {
  name_prefix = "${local.name_prefix}-postgres-"
  description = "PostgreSQL access from the Private Family OS API only"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from API service"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.api_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${local.name_prefix}-postgres"
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = "16"
  instance_class = var.database_instance_class

  allocated_storage     = 50
  max_allocated_storage = 500
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.restricted_data.arn

  db_name                     = var.database_name
  username                    = var.database_master_username
  manage_master_user_password = true
  port                        = 5432

  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.postgres.id]
  publicly_accessible    = false
  multi_az               = var.environment == "production"

  backup_retention_period = var.environment == "production" ? max(35, var.database_backup_retention_days) : var.database_backup_retention_days
  backup_window           = "03:00-03:30"
  maintenance_window      = "sun:04:00-sun:04:30"
  deletion_protection     = var.environment == "production" ? true : var.deletion_protection
  skip_final_snapshot     = var.environment == "production" ? false : true
  copy_tags_to_snapshot   = true

  performance_insights_enabled          = true
  performance_insights_retention_period = 7
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  auto_minor_version_upgrade            = true
  apply_immediately                     = false
}

output "private_assets_bucket_name" {
  value       = aws_s3_bucket.private_assets.bucket
  description = "Private encrypted bucket for original user-owned assets."
}

output "ingestion_queue_url" {
  value       = aws_sqs_queue.ingestion.url
  description = "Queue for asynchronous ingestion; worker IAM is added with the API/worker service module."
}

output "database_secret_arn" {
  value       = aws_db_instance.postgres.master_user_secret[0].secret_arn
  description = "AWS-managed secret ARN. Never output a raw password."
}

output "database_security_group_id" {
  value = aws_security_group.postgres.id
}
