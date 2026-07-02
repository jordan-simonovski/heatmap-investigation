global.IntersectionObserver = class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const { errorCount } = require('./ErrorInsightsDrawer');

describe('errorCount', () => {
  it('is 0 when there is no data', () => {
    expect(errorCount(undefined)).toBe(0);
    expect(errorCount({ series: [] })).toBe(0);
  });

  it('reflects the row count of the first series (glow trigger)', () => {
    const data = { series: [{ length: 3 }] };
    expect(errorCount(data)).toBe(3);
    expect(errorCount(data) > 0).toBe(true);
  });
});
