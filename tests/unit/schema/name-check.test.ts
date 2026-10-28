import { suggest } from '../../../src/schema/name-check.js';

describe('suggest', () => {
  it('matches across underscores', () => {
    expect(suggest('user_name', ['id', 'username', 'email'])).toEqual(['username']);
  });

  it('ranks the closest typo first', () => {
    expect(suggest('custmer_id', ['customer_id', 'id'])[0]).toBe('customer_id');
  });

  it('catches a one-letter typo', () => {
    expect(suggest('userz', ['users', 'orders'])).toEqual(['users']);
  });

  it('treats singular and plural as a match', () => {
    expect(suggest('order', ['orders', 'users'])).toEqual(['orders']);
  });

  it('ignores case', () => {
    expect(suggest('USERNAME', ['username'])).toEqual(['username']);
  });

  it('makes no wild guesses', () => {
    expect(suggest('foo', ['id', 'username', 'created_at'])).toEqual([]);
  });

  it('caps the number of results', () => {
    const candidates = ['user1', 'user2', 'user3', 'user4', 'user5'];
    expect(suggest('user', candidates, 2)).toHaveLength(2);
    expect(suggest('user', candidates)).toHaveLength(3);
  });
});
