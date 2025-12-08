# School Contest Portal API

This document describes the HTTP API provided by the NestJS backend in this repository.

- Base URL: `http://localhost:<PORT>` (default `http://localhost:3000`)
- Swagger UI: `GET /api`
- Static uploads: `GET /uploads/**`

> Note: Responses are JSON unless otherwise specified. All timestamps are ISO 8601 strings in UTC.

## Authentication

Administrator-only endpoints use JWT bearer tokens. Tokens are issued by the login endpoint and must be sent in the `Authorization` header.

### Login

- Method: `POST`
- Path: `/auth/login`
- Auth: none
- Content-Type: `application/json`

#### Request body

```json
{
  "password": "string"
}
```

The password is compared against the `ADMIN_PASSWORD` environment variable. If it does not match, the API returns `401 Unauthorized`.

#### Successful response (200)

```json
{
  "access_token": "string"
}
```

Use the returned token in the `Authorization` header:

```http
Authorization: Bearer <access_token>
```

The token:

- Has payload `{ "role": "admin" }`
- Is signed with `JWT_SECRET`
- Expires in 1 day

## Global behaviour

### Validation

The application uses NestJS `ValidationPipe` globally with:

- `transform: true` – converts payload values to DTO property types when possible
- `whitelist: true` – strips properties that are not defined in DTOs

If validation fails, the API returns `400 Bad Request` with a structured error body (see below).

### Error responses

All unhandled errors are transformed by `HttpExceptionFilter` into a standard JSON shape:

```json
{
  "statusCode": 400,
  "message": "Error message or object",
  "error": "Bad Request",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

Notes:

- `statusCode` is the HTTP status code.
- `message` may be a string or, for validation, a more complex object/array.
- `error` is present for typical HTTP exceptions (for example `"Bad Request"`).
- `timestamp` is always included.

### Rate limiting

The application uses `@nestjs/throttler` with a global guard:

- Default limit: 10 requests per 60 seconds per client (IP or context dependent).

For the `POST /submissions` endpoint a tighter limit is applied:

- Custom limit: 5 requests per 60 seconds per client.

Exceeding the limit results in `429 Too Many Requests`.

### CORS

CORS is enabled with:

- Allowed origins: `http://localhost:5173`
- `credentials: true`

## Root endpoint

### GET /

- Method: `GET`
- Path: `/`
- Auth: none

Returns a simple string to verify that the service is running.

#### Successful response (200)

```json
"Hello World!"
```

## Submissions

All submission-related endpoints live under the `/submissions` path and operate on the `Submission` model.

### Submission data model

The core data stored in the database via Prisma:

```ts
type Category = "PROGRAMMING" | "AIGC";

type Submission = {
  id: string;            // UUID
  studentName: string;
  grade: number;         // 1 - 6
  classNumber: number;   // >= 1
  category: Category;
  workTitle: string;
  fileName: string;      // original file name (decoded to UTF-8)
  storedFileName: string;
  fileType: string;      // MIME type reported by the upload
  fileSize: number;      // in bytes
  submittedAt: string;   // ISO timestamp
};
```

### Create submission

- Method: `POST`
- Path: `/submissions`
- Auth: none
- Rate limit: 5 requests per 60 seconds per client
- Content-Type: `multipart/form-data`

This endpoint accepts a form with metadata fields plus a file upload.

#### Form fields

| Field        | Type    | Required | Description                                                      |
| ------------ | ------- | -------- | ---------------------------------------------------------------- |
| `studentName`| string  | yes      | Student name, 2 to 10 characters.                               |
| `grade`      | number  | yes      | Grade, integer between 1 and 6.                                 |
| `classNumber`| number  | yes      | Class number, integer >= 1.                                     |
| `category`   | string  | yes      | One of `PROGRAMMING` or `AIGC`.                                 |
| `workTitle`  | string  | yes      | Work title, 1 to 50 characters.                                 |
| `file`       | file    | yes      | Uploaded file, validated by category and size (see below).      |

Validation rules are enforced both by DTOs and by the upload pipeline.

#### File requirements

- Field name: `file`
- Maximum size: 50 MB
- For `category = PROGRAMMING`:
  - Allowed extensions: `.sb3`, `.mp`
  - File content must be a ZIP container (header bytes `0x50 0x4b`)
- For `category = AIGC`:
  - Allowed extensions and signatures:
    - PNG: extension `.png` and standard PNG header
    - JPEG: extension `.jpg` or `.jpeg` and standard JPEG header

If the category/file combination is invalid, or if the file is missing, the endpoint returns `400 Bad Request` with a message explaining what is wrong (for example `Unsupported file type for the given category` or `File is required`).

> Implementation note: the server reads the beginning of the uploaded file to verify its magic bytes and prevent disguised executables.

#### Successful response (201)

On success the endpoint creates a `Submission` record and returns it as JSON:

```json
{
  "id": "uuid",
  "studentName": "Alice",
  "grade": 3,
  "classNumber": 2,
  "category": "PROGRAMMING",
  "workTitle": "My Project",
  "fileName": "project.sb3",
  "storedFileName": "a5c9fc2e-4d53-4a9f-9e3c-2b4c73dfc1b2.sb3",
  "fileType": "application/zip",
  "fileSize": 123456,
  "submittedAt": "2025-01-01T00:00:00.000Z"
}
```

### List all submissions

- Method: `GET`
- Path: `/submissions`
- Auth: required (`Authorization: Bearer <token>`)

Returns all submissions ordered by `submittedAt` in descending order (most recent first).

#### Successful response (200)

```json
[
  {
    "id": "uuid",
    "studentName": "Alice",
    "grade": 3,
    "classNumber": 2,
    "category": "PROGRAMMING",
    "workTitle": "My Project",
    "fileName": "project.sb3",
    "storedFileName": "a5c9fc2e-4d53-4a9f-9e3c-2b4c73dfc1b2.sb3",
    "fileType": "application/zip",
    "fileSize": 123456,
    "submittedAt": "2025-01-01T00:00:00.000Z"
  }
]
```

If the JWT is missing or invalid, the endpoint returns `401 Unauthorized`.

### List final submission per student and category

- Method: `GET`
- Path: `/submissions/final`
- Auth: required (`Authorization: Bearer <token>`)

Returns, for each unique combination of:

- `grade`
- `classNumber`
- `studentName`
- `category`

only the latest submission (by `submittedAt`). The response shape is the same as for `GET /submissions` (an array of `Submission` objects).

### Download submission file

- Method: `GET`
- Path: `/submissions/:id/download`
- Auth: required (`Authorization: Bearer <token>`)

Downloads the file associated with a submission.

#### Path parameters

| Name | Type   | Description                   |
| ---- | ------ | ----------------------------- |
| `id` | string | Submission ID (UUID format).  |

#### Behaviour

1. Looks up the submission record by ID.
2. Resolves the file from the `uploads` directory using `storedFileName`.
3. If the record or file is missing, returns `404 Not Found`.
4. Sends the file content using `res.sendFile(...)`.
5. Sets the `Content-Disposition` header to suggest a meaningful download name based on grade, class number and student name, with a derived or original extension.

Typical failure responses:

- `404 Not Found` with message `Submission not found` if the record does not exist.
- `404 Not Found` with message `File not found` if the database record exists but the file is missing on disk.

### Check daily submission quota

- Method: `GET`
- Path: `/submissions/check`
- Auth: none

Checks whether the given student is allowed to submit a new work today.

#### Query parameters

| Name          | Type   | Required | Description                         |
| ------------- | ------ | -------- | ----------------------------------- |
| `studentName` | string | yes      | Student name to check for the day.  |

If `studentName` is missing, the endpoint returns `400 Bad Request` with message `studentName is required`.

#### Successful response (200)

```json
{
  "canSubmit": true
}
```

The value is `false` when at least one submission by the same `studentName` already exists between the start of today and the start of tomorrow (inclusive of start, exclusive of end).

## Static uploads

In addition to the controlled download endpoint, the server exposes the `uploads` directory as static files:

- Method: `GET`
- Path: `/uploads/**`
- Auth: none

This is configured via `ServeStaticModule` and serves whatever files are present in the `uploads` directory. When accessing files directly through this path, file names are those stored on disk (`storedFileName`) rather than the friendly names used by the download endpoint.

## Environment variables

The application relies on the following environment variables:

| Name            | Required | Description                                              |
| --------------- | -------- | -------------------------------------------------------- |
| `PORT`          | no       | HTTP port to listen on (default `3000`).                |
| `DATABASE_URL`  | yes      | PostgreSQL connection string used by Prisma.            |
| `ADMIN_PASSWORD`| yes      | Password required by `POST /auth/login`.                |
| `JWT_SECRET`    | yes      | Secret key for signing and verifying JWT tokens.        |

Ensure these variables are set correctly before starting the application.

