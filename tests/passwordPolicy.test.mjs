import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passwordProblem, generatePassword } from '../js/passwordPolicy.js';

test('accepts passwords with 8+ characters and all four character types', () => {
  for (const p of ['Abcdef1!', 'Long enough 9', 'Test-pass-123', 'ÄÖ-ok Aa1']) assert.equal(passwordProblem(p), null, p);
});

test('names everything a weak password is missing', () => {
  assert.equal(passwordProblem('Ab1!xyz'), 'Password needs at least 8 characters.');
  assert.equal(passwordProblem('NoSymbols123'), 'Password needs a symbol (e.g. ! @ # -).');
  assert.equal(
    passwordProblem('abc'),
    'Password needs at least 8 characters, an uppercase letter, a number and a symbol (e.g. ! @ # -).',
  );
  assert.match(passwordProblem(''), /^Password needs at least 8 characters, an uppercase letter, a lowercase letter, a number and a symbol/);
});

test('generatePassword always passes the rule', () => {
  for (let i = 0; i < 200; i++) assert.equal(passwordProblem(generatePassword()), null);
});
