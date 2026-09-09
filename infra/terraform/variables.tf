variable "aws_region" {
  description = "AWS region for this environment. Keep all restricted data in the approved U.S. region."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short, lowercase application identifier used in resource names."
  type        = string
  default     = "private-family-os"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "project_name may contain only lowercase letters, numbers and hyphens."
  }
}

variable "environment" {
  description = "Deployment environment. Production must be isolated from non-production."
  type        = string

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging or production."
  }
}

variable "vpc_id" {
  description = "Existing private VPC ID. Networking is deliberately supplied rather than created implicitly."
  type        = string
}

variable "private_subnet_ids" {
  description = "At least two private subnets for RDS and private workers."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "At least two private subnet IDs are required."
  }
}

variable "api_security_group_id" {
  description = "Security group attached to the API service. It is the only allowed inbound database client."
  type        = string
}

variable "database_instance_class" {
  description = "RDS instance class. Use a small development class only outside production."
  type        = string
  default     = "db.t4g.medium"
}

variable "database_name" {
  description = "Initial PostgreSQL database name."
  type        = string
  default     = "privatefamily"
}

variable "database_master_username" {
  description = "RDS master username. The password is managed by AWS Secrets Manager."
  type        = string
  default     = "pf_admin"
}

variable "database_backup_retention_days" {
  description = "Backup retention. Production should retain at least 35 days."
  type        = number
  default     = 7

  validation {
    condition     = var.database_backup_retention_days >= 7 && var.database_backup_retention_days <= 35
    error_message = "database_backup_retention_days must be between 7 and 35."
  }
}

variable "deletion_protection" {
  description = "Must be true in production."
  type        = bool
  default     = false
}

variable "force_destroy_object_storage" {
  description = "Never enable in production; protects restricted originals from accidental deletion."
  type        = bool
  default     = false
}
