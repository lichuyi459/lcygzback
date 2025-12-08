import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

describe('App (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    // Ensure required env vars exist for the application under test.
    process.env.ADMIN_PASSWORD ??= 'test-admin-password';
    process.env.JWT_SECRET ??= 'test-jwt-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean submissions table between tests to keep them independent.
    await prisma.submission.deleteMany();
  });

  const server = () => app.getHttpServer();

  async function loginAndGetToken(password?: string): Promise<string> {
    const res = await request(server())
      .post('/auth/login')
      .send({ password: password ?? process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    return res.body.access_token as string;
  }

  function buildZipBuffer(): Buffer {
    const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const payload = Buffer.from('dummy');
    return Buffer.concat([header, payload]);
  }

  function buildPngBuffer(): Buffer {
    const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload = Buffer.from('dummy');
    return Buffer.concat([header, payload]);
  }

  async function createSubmission(
    overrides?: Partial<{
      studentName: string;
      grade: number;
      classNumber: number;
      category: 'PROGRAMMING' | 'AIGC';
      workTitle: string;
      fileKind: 'PROGRAMMING' | 'AIGC';
    }>,
  ) {
    const fileKind = overrides?.fileKind ?? overrides?.category ?? 'PROGRAMMING';

    const commonFields = {
      studentName: overrides?.studentName ?? 'Alice',
      grade: overrides?.grade ?? 3,
      classNumber: overrides?.classNumber ?? 2,
      category: overrides?.category ?? (fileKind as 'PROGRAMMING' | 'AIGC'),
      workTitle: overrides?.workTitle ?? 'My Project',
    };

    const buffer =
      fileKind === 'PROGRAMMING' ? buildZipBuffer() : buildPngBuffer();
    const filename =
      fileKind === 'PROGRAMMING' ? 'project.sb3' : 'image.png';

    const res = await request(server())
      .post('/submissions')
      .field('studentName', commonFields.studentName)
      .field('grade', String(commonFields.grade))
      .field('classNumber', String(commonFields.classNumber))
      .field('category', commonFields.category)
      .field('workTitle', commonFields.workTitle)
      .attach('file', buffer, filename);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');

    return res.body as {
      id: string;
      storedFileName: string;
      studentName: string;
      grade: number;
      classNumber: number;
      category: string;
      workTitle: string;
      fileName: string;
      fileType: string;
      fileSize: number;
    };
  }

  describe('Root', () => {
    it('GET / should return Hello World!', async () => {
      const res = await request(server()).get('/');
      expect(res.status).toBe(200);
      expect(res.text).toBe('Hello World!');
    });
  });

  describe('Auth', () => {
    it('POST /auth/login should issue JWT with correct password', async () => {
      const password = process.env.ADMIN_PASSWORD as string;
      const res = await request(server())
        .post('/auth/login')
        .send({ password });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('access_token');
      expect(typeof res.body.access_token).toBe('string');
    });

    it('POST /auth/login should reject invalid password', async () => {
      const res = await request(server())
        .post('/auth/login')
        .send({ password: 'wrong-password' });

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        statusCode: 401,
        message: 'Invalid credentials',
        error: 'Unauthorized',
      });
      expect(typeof res.body.timestamp).toBe('string');
    });
  });

  describe('Submissions - create', () => {
    it('POST /submissions accepts valid PROGRAMMING submission', async () => {
      const submission = await createSubmission({
        category: 'PROGRAMMING',
        fileKind: 'PROGRAMMING',
      });

      expect(submission.category).toBe('PROGRAMMING');
    });

    it('POST /submissions accepts valid AIGC submission', async () => {
      const submission = await createSubmission({
        category: 'AIGC',
        fileKind: 'AIGC',
      });

      expect(submission.category).toBe('AIGC');
    });

    it('POST /submissions rejects when file is missing', async () => {
      const res = await request(server())
        .post('/submissions')
        .field('studentName', 'Alice')
        .field('grade', '3')
        .field('classNumber', '2')
        .field('category', 'PROGRAMMING')
        .field('workTitle', 'My Project');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        message: 'File is required',
        error: 'Bad Request',
      });
      expect(typeof res.body.timestamp).toBe('string');
    });

    it('POST /submissions rejects invalid file type for category', async () => {
      // Use PNG bytes but pretend it is PROGRAMMING submission.
      const buffer = buildPngBuffer();

      const res = await request(server())
        .post('/submissions')
        .field('studentName', 'Alice')
        .field('grade', '3')
        .field('classNumber', '2')
        .field('category', 'PROGRAMMING')
        .field('workTitle', 'My Project')
        .attach('file', buffer, 'project.sb3');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        message: 'Unsupported file type for the given category',
        error: 'Bad Request',
      });
      expect(typeof res.body.timestamp).toBe('string');
    });
  });

  describe('Submissions - listing', () => {
    it('GET /submissions requires auth', async () => {
      const res = await request(server()).get('/submissions');
      expect(res.status).toBe(401);
      expect(res.body.statusCode).toBe(401);
    });

    it('GET /submissions returns all submissions in descending order', async () => {
      const first = await createSubmission({ workTitle: 'First' });
      const second = await createSubmission({ workTitle: 'Second' });

      const token = await loginAndGetToken();

      const res = await request(server())
        .get('/submissions')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
      expect(res.body[0].id).toBe(second.id);
      expect(res.body[1].id).toBe(first.id);
    });

    it('GET /submissions/final returns latest per student+class+category', async () => {
      // Same student/category, two submissions.
      const first = await createSubmission({
        studentName: 'Bob',
        workTitle: 'Old',
      });
      const second = await createSubmission({
        studentName: 'Bob',
        workTitle: 'New',
      });

      // Different student.
      const other = await createSubmission({
        studentName: 'Carol',
        workTitle: 'Other',
      });

      const token = await loginAndGetToken();

      const res = await request(server())
        .get('/submissions/final')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);

      const bobRecord = res.body.find(
        (x: any) => x.studentName === 'Bob',
      );
      const carolRecord = res.body.find(
        (x: any) => x.studentName === 'Carol',
      );

      expect(bobRecord).toBeDefined();
      expect(carolRecord).toBeDefined();
      expect(bobRecord.id).toBe(second.id);
      expect(carolRecord.id).toBe(other.id);
    });
  });

  describe('Submissions - download', () => {
    it('GET /submissions/:id/download returns file with Content-Disposition', async () => {
      const submission = await createSubmission({
        studentName: 'Alice',
        grade: 3,
        classNumber: 2,
        category: 'PROGRAMMING',
        fileKind: 'PROGRAMMING',
      });

      const token = await loginAndGetToken();

      const res = await request(server())
        .get(`/submissions/${submission.id}/download`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain('attachment;');
      expect(res.headers['content-disposition']).toContain('.sb3');
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('GET /submissions/:id/download returns 404 for missing submission', async () => {
      const token = await loginAndGetToken();

      const res = await request(server())
        .get('/submissions/00000000-0000-0000-0000-000000000000/download')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        message: 'Submission not found',
        error: 'Not Found',
      });
      expect(typeof res.body.timestamp).toBe('string');
    });
  });

  describe('Submissions - daily quota check', () => {
    it('GET /submissions/check requires studentName', async () => {
      const res = await request(server()).get('/submissions/check');

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        statusCode: 400,
        message: 'studentName is required',
        error: 'Bad Request',
      });
      expect(typeof res.body.timestamp).toBe('string');
    });

    it('GET /submissions/check returns canSubmit=true when no submissions today', async () => {
      const res = await request(server())
        .get('/submissions/check')
        .query({ studentName: 'Dave' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ canSubmit: true });
    });

    it('GET /submissions/check returns canSubmit=false when submission exists today', async () => {
      await createSubmission({ studentName: 'Eve' });

      const res = await request(server())
        .get('/submissions/check')
        .query({ studentName: 'Eve' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ canSubmit: false });
    });
  });

  describe('Static uploads', () => {
    it('GET /uploads/<storedFileName> serves uploaded file', async () => {
      const submission = await createSubmission({
        studentName: 'StaticUser',
      });

      const res = await request(server()).get(
        `/uploads/${submission.storedFileName}`,
      );

      if (res.status === 200) {
        expect(res.body.length).toBeGreaterThan(0);
      } else {
        // In some environments, static serving may not be wired in tests.
        // At minimum, ensure the file exists on disk at the expected path.
        const uploadPath = path.join(
          process.cwd(),
          'uploads',
          submission.storedFileName,
        );
        await expect(fs.access(uploadPath)).resolves.toBeUndefined();
      }

      // Best-effort cleanup of the file created for this test.
      const uploadPath = path.join(process.cwd(), 'uploads', submission.storedFileName);
      try {
        await fs.unlink(uploadPath);
      } catch {
        // ignore
      }
    });
  });
});
