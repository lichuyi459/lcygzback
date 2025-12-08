import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export type SubmissionCategory = 'PROGRAMMING' | 'AIGC';

export class CreateSubmissionDto {
  @IsString()
  @Length(2, 10)
  studentName!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(6)
  grade!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  classNumber!: number;

  @IsString()
  @IsIn(['PROGRAMMING', 'AIGC'])
  category!: SubmissionCategory;

  @IsString()
  @Length(1, 50)
  workTitle!: string;
}

