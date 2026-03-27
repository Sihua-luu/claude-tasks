import {
  CreateTableCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';
import { ddb } from './client.js';

const JOBS_TABLE: CreateTableCommandInput = {
  TableName: 'Jobs',
  KeySchema: [
    { AttributeName: 'user_id', KeyType: 'HASH' },
    { AttributeName: 'job_id', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'user_id', AttributeType: 'S' },
    { AttributeName: 'job_id', AttributeType: 'S' },
    { AttributeName: 'created_at', AttributeType: 'S' },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'GSI_UserCreatedAt',
      KeySchema: [
        { AttributeName: 'user_id', KeyType: 'HASH' },
        { AttributeName: 'created_at', KeyType: 'RANGE' },
      ],
      Projection: { ProjectionType: 'ALL' },
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
  ],
  ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
};

const JOB_RUN_TABLE: CreateTableCommandInput = {
  TableName: 'JobRun',
  KeySchema: [
    { AttributeName: 'time_bucket', KeyType: 'HASH' },
    { AttributeName: 'scheduled_at_job_id', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'time_bucket', AttributeType: 'S' },
    { AttributeName: 'scheduled_at_job_id', AttributeType: 'S' },
    { AttributeName: 'job_id', AttributeType: 'S' },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'GSI_JobId',
      KeySchema: [{ AttributeName: 'job_id', KeyType: 'HASH' }],
      Projection: { ProjectionType: 'ALL' },
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
  ],
  ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
};

const RUN_EVENT_TABLE: CreateTableCommandInput = {
  TableName: 'RunEvent',
  KeySchema: [
    { AttributeName: 'job_run_id', KeyType: 'HASH' },
    { AttributeName: 'id', KeyType: 'RANGE' },
  ],
  AttributeDefinitions: [
    { AttributeName: 'job_run_id', AttributeType: 'S' },
    { AttributeName: 'id', AttributeType: 'S' },
  ],
  ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
};

export async function ensureTables(): Promise<void> {
  for (const def of [JOBS_TABLE, JOB_RUN_TABLE, RUN_EVENT_TABLE]) {
    try {
      await ddb.send(new CreateTableCommand(def));
      console.log(`Created table: ${def.TableName}`);
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ResourceInUseException') {
        console.log(`Table already exists: ${def.TableName}`);
      } else {
        throw err;
      }
    }
  }
}
