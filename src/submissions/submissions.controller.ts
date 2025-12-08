import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { SubmissionsService } from './submissions.service';

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll() {
    return this.submissionsService.findAll();
  }

  @Get('final')
  @UseGuards(JwtAuthGuard)
  async findFinal() {
    return this.submissionsService.findFinalSubmissions();
  }

  @Get(':id/download')
  @UseGuards(JwtAuthGuard)
  async download(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const submission = await this.submissionsService.findById(id);
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    const uploadDir = path.join(process.cwd(), 'uploads');
    const filePath = path.join(uploadDir, submission.storedFileName);

    try {
      await fs.access(filePath);
    } catch {
      throw new NotFoundException('File not found');
    }

    const stream = createReadStream(filePath);

    const originalExt = path.extname(submission.fileName);
    const storedExt = path.extname(submission.storedFileName);
    const ext = originalExt || storedExt;

    const safeStudentName = submission.studentName.replace(/[\"\\/]/g, '_');
    const downloadName = `${submission.grade}-${submission.classNumber}-${safeStudentName}${ext}`;

    res.set({
      'Content-Type': submission.fileType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
    });

    return new StreamableFile(stream);
  }

  @Get('check')
  async checkQuota(@Query('studentName') studentName?: string) {
    if (!studentName) {
      throw new BadRequestException('studentName is required');
    }

    const hasSubmission =
      await this.submissionsService.hasSubmissionToday(studentName);

    return { canSubmit: !hasSubmission };
  }

  @Post()
  @Throttle({
    default: {
      limit: 5,
      ttl: 60_000,
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadDir = path.join(process.cwd(), 'uploads');
          fs.mkdir(uploadDir, { recursive: true })
            .then(() => cb(null, uploadDir))
            .catch(() =>
              cb(
                new BadRequestException('Failed to prepare upload directory'),
                '',
              ),
            );
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname);
          const storedName = `${randomUUID()}${ext}`;
          cb(null, storedName);
        },
      }),
    }),
  )
  async create(
    @Body() body: CreateSubmissionDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    await this.validateUploadedFile(body.category, file);

    return this.submissionsService.createSubmission(body, file);
  }

  // Performs category-specific file validation using extension and magic bytes.
  private async validateUploadedFile(
    category: string,
    file: Express.Multer.File,
  ): Promise<void> {
    const filePath = file.path;
    const ext = path.extname(file.originalname).toLowerCase();

    const buffer = Buffer.alloc(8);
    const handle = await fs.open(filePath, 'r');
    try {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead === 0) {
        await this.removeFileSafe(filePath);
        throw new BadRequestException('Uploaded file is empty');
      }

      if (category === 'PROGRAMMING') {
        const isAllowedExt = ext === '.sb3' || ext === '.mp';
        const isZipHeader = buffer[0] === 0x50 && buffer[1] === 0x4b;
        if (!isAllowedExt || !isZipHeader) {
          await this.removeFileSafe(filePath);
          throw new BadRequestException(
            'Unsupported file type for the given category',
          );
        }
      } else if (category === 'AIGC') {
        const isPngExt = ext === '.png';
        const isJpegExt = ext === '.jpg' || ext === '.jpeg';

        const isPngHeader =
          bytesRead >= 8 &&
          buffer[0] === 0x89 &&
          buffer[1] === 0x50 &&
          buffer[2] === 0x4e &&
          buffer[3] === 0x47 &&
          buffer[4] === 0x0d &&
          buffer[5] === 0x0a &&
          buffer[6] === 0x1a &&
          buffer[7] === 0x0a;

        const isJpegHeader =
          bytesRead >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;

        const isValid =
          (isPngExt && isPngHeader) || (isJpegExt && isJpegHeader);

        if (!isValid) {
          await this.removeFileSafe(filePath);
          throw new BadRequestException(
            'Unsupported file type for the given category',
          );
        }
      } else {
        await this.removeFileSafe(filePath);
        throw new BadRequestException('Unsupported submission category');
      }
    } finally {
      await handle.close();
    }
  }

  private async removeFileSafe(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch {
      // Best-effort cleanup only.
    }
  }
}
