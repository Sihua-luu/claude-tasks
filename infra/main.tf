terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  default = "us-east-1"
}

# --- DynamoDB Tables ---

resource "aws_dynamodb_table" "jobs" {
  name         = "Jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"
  range_key    = "job_id"

  attribute {
    name = "user_id"
    type = "S"
  }
  attribute {
    name = "job_id"
    type = "S"
  }
  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI_UserCreatedAt"
    hash_key        = "user_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_dynamodb_table" "job_run" {
  name         = "JobRun"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "time_bucket"
  range_key    = "scheduled_at_job_id"

  attribute {
    name = "time_bucket"
    type = "S"
  }
  attribute {
    name = "scheduled_at_job_id"
    type = "S"
  }
  attribute {
    name = "job_id"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI_JobId"
    hash_key        = "job_id"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }
}

resource "aws_dynamodb_table" "run_event" {
  name         = "RunEvent"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "job_run_id"
  range_key    = "id"

  attribute {
    name = "job_run_id"
    type = "S"
  }
  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }
}

# --- SQS ---

resource "aws_sqs_queue" "job_runs_dlq" {
  name                      = "job-runs-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "job_runs" {
  name                       = "job-runs"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.job_runs_dlq.arn
    maxReceiveCount     = 3
  })
}
