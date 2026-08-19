(() => {
  const P = window.MythicParcel;
  if (!P) return JSON.stringify({ err: 'not mounted' });
  const v = P.verify ? P.verify() : { err: 'no verify()' };
  return JSON.stringify(v, null, 1);
})()
