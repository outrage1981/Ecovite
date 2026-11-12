/// <reference path="../pb_data/types.d.ts" />
// Users get a separate Surname field (the existing `name` field now holds
// the first name; the app shows "Name Surname"), and passwords must meet
// the complexity rule in js/passwordPolicy.js — keep the two in step.
//
// PocketBase validates the password field against `pattern` whenever a
// new password is set: creating a user, an admin setting one, and the
// "forgot password" reset. Its regex engine (Go RE2) has no lookaheads,
// so "contains each of these four kinds of character" is written as one
// alternative per possible order the four first appear in (4! = 24).

migrate((app) => {
  const kinds = ['[A-Z]', '[a-z]', '[0-9]', '[^A-Za-z0-9]'];
  const orders = (items) =>
    items.length <= 1 ? [items] : items.flatMap((x, i) => orders(items.filter((_, j) => j !== i)).map((rest) => [x, ...rest]));
  const pattern = '(?s)^(?:' + orders(kinds).map((o) => o.map((k) => '.*' + k).join('')).join('|') + ').*$';

  const users = app.findCollectionByNameOrId('users');
  if (!users.fields.getByName('surname')) {
    users.fields.add(new TextField({ name: 'surname', max: 255 }));
  }
  const password = users.fields.getByName('password');
  password.min = 8;
  password.pattern = pattern;
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  users.fields.removeByName('surname');
  const password = users.fields.getByName('password');
  password.pattern = '';
  app.save(users);
});
