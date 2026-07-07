export abstract class BaseSpecs {
  protected _id?: string;
  protected _idList?: string[];
  protected _limit = 20;
  protected _offset = 0;
  protected _shouldIncludeDeleted = false;

  get id() {
    return this._id;
  }
  setId(value: string) {
    this._id = value;
    return this;
  }

  get idList() {
    return this._idList;
  }
  setIdList(value: string[]) {
    this._idList = value;
    return this;
  }

  get limit() {
    return this._limit;
  }
  setLimit(value: number) {
    this._limit = value;
    return this;
  }

  get offset() {
    return this._offset;
  }
  setOffset(value: number) {
    this._offset = value;
    return this;
  }

  get shouldIncludeDeleted() {
    return this._shouldIncludeDeleted;
  }
  setShouldIncludeDeleted(value: boolean) {
    this._shouldIncludeDeleted = value;
    return this;
  }
}
