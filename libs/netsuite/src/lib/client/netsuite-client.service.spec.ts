import { emptyResponse, isInvalidSuiteQLQueryError } from './netsuite-client.service';

describe('isInvalidSuiteQLQueryError (LEVEL 2 trigger)', () => {
  it('is true for a schema error surfaced in the error message', () => {
    expect(isInvalidSuiteQLQueryError(new Error('unknown identifier'))).toBe(true);
  });

  it('is true for a schema error nested in NetSuite o:errorDetails', () => {
    const error = {
      response: {
        data: {
          'o:errorDetails': [{ detail: "Field 'custbody_ra_order_type' was not found." }],
        },
      },
    };
    expect(isInvalidSuiteQLQueryError(error)).toBe(true);
  });

  it('is false for a plain 500 (transport failure, retried at LEVEL 1)', () => {
    const error = { message: 'Request failed with status code 500', response: { status: 500 } };
    expect(isInvalidSuiteQLQueryError(error)).toBe(false);
  });

  it('is false for an empty / unknown error', () => {
    expect(isInvalidSuiteQLQueryError(null)).toBe(false);
    expect(isInvalidSuiteQLQueryError({})).toBe(false);
  });
});

describe('emptyResponse', () => {
  it('returns a well-formed empty SuiteQL envelope', () => {
    expect(emptyResponse()).toEqual({
      links: [],
      count: 0,
      hasMore: false,
      items: [],
      offset: 0,
      totalResults: 0,
    });
  });
});
