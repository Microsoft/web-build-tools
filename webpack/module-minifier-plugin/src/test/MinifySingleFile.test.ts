import { minifySingleFile } from '../terser/MinifySingleFile';

describe('minifySingleFile', () => {
  it('uses consistent identifiers for webpack vars', () => {
    const code: string = `__MINIFY_MODULE__(function (module, __webpack_exports__, __webpack_require__) {});`;

    const minifierResult = minifySingleFile(
      {
        hash: 'foo',
        code,
        nameForMap: undefined,
        externals: undefined
      },
      {
        mangle: true
      }
    );

    expect(minifierResult).toMatchSnapshot();
  });
});
