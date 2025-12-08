import { Injectable } from '@nestjs/common';
import type { Category } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createSubmission(
    dto: CreateSubmissionDto,
    file: Express.Multer.File,
  ) {
    const { originalname, mimetype, size, filename } = file;

    return this.prisma.submission.create({
      data: {
        studentName: dto.studentName,
        grade: dto.grade,
        classNumber: dto.classNumber,
        category: dto.category as Category,
        workTitle: dto.workTitle,
        fileName: originalname,
        storedFileName: filename,
        fileType: mimetype,
        fileSize: size,
      },
    });
  }

  async findAll() {
    return this.prisma.submission.findMany({
      orderBy: {
        submittedAt: 'desc',
      },
    });
  }

  async findFinalSubmissions() {
    // For each unique combination of grade, classNumber, studentName, and
    // category, return only the latest submission (by submittedAt).
    return this.prisma.submission.findMany({
      orderBy: {
        submittedAt: 'desc',
      },
      distinct: ['grade', 'classNumber', 'studentName', 'category'],
    });
  }

  async findById(id: string) {
    return this.prisma.submission.findUnique({
      where: { id },
    });
  }

  async hasSubmissionToday(studentName: string): Promise<boolean> {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const count = await this.prisma.submission.count({
      where: {
        studentName,
        submittedAt: {
          gte: startOfToday,
          lt: startOfTomorrow,
        },
      },
    });

    return count > 0;
  }
}
