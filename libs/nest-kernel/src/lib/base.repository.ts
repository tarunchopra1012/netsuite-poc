import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';

/**
 * All repositories extend this. Concrete repos set `protected model = XPersistence`
 * and call `this.getDBRepository()` to get a typed TypeORM repository.
 * Repos map to/from domain via a Mapper and RETURN AppError on failure.
 */
@Injectable()
export abstract class BaseRepository<T extends ObjectLiteral> {
  protected abstract model: EntityTarget<T>;

  constructor(@InjectDataSource() protected readonly dataSource: DataSource) {}

  protected getDBRepository() {
    return this.dataSource.getRepository(this.model);
  }
}
