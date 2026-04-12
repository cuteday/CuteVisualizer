export function getGridLayout(count) {
  if (count <= 1) {
    return { columns: 1, rows: 1 };
  }

  if (count <= 3) {
    return { columns: count, rows: 1 };
  }

  if (count <= 4) {
    return { columns: 2, rows: 2 };
  }

  if (count <= 6) {
    return { columns: 3, rows: 2 };
  }

  return { columns: 3, rows: 3 };
}
