import { crc32, workbookFiles, zip } from './xlsx';

describe('xlsx', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes escaped text, numbers and bold rows into the sheet', () => {
    const files = workbookFiles([{ name: 'Schulden & Sparen', columns: [10, 10], rows: [['A&B', 1.5], [null, 2]], boldRows: [0] }]);
    expect(files['xl/workbook.xml']).toContain('name="Schulden &amp; Sparen"');
    const sheet = files['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="2"><is><t xml:space="preserve">A&amp;B</t></is></c>');
    expect(sheet).toContain('<c r="B1" s="3"><v>1.5</v></c>');
    expect(sheet).toContain('<row r="2"><c r="B2" s="1"><v>2</v></c></row>');
  });

  it('builds a zip with one entry per file', () => {
    const data = zip({ 'a.txt': 'ä', 'b/c.xml': '<x/>' });
    const view = new DataView(data.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = data.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
  });
});
