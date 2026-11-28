import { jsPDF } from 'jspdf';
import type { EmployeeDetails } from '../types/payroll';
import {
  buildWhatsAppLoanSummaryText,
  type LoanLedgerSummary,
} from './loanLedger';
import {
  saveFileToDevice,
  shareSlipToWhatsApp,
  stripDataUrlPrefix,
  type WhatsAppShareResult,
} from './nativeFileHelper';
import { formatCurrency } from './salaryMath';

function formatNowTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function drawTruncatedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
) {
  if (!text) return;
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(trimmed + '…').width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  ctx.fillText(trimmed + '…', x, y);
}

export async function buildLoanLedgerJpg(
  employee: EmployeeDetails,
  ledger: LoanLedgerSummary
): Promise<{ blob: Blob; dataUrl: string; filename: string }> {
  const width = 1480;
  const margin = 56;
  const contentW = width - margin * 2; // 1368

  const rowH = 44;
  const visibleRows = Math.max(1, ledger.rows.length);
  const tableBlockH = 46 + visibleRows * rowH + 48; // header + rows + total footer
  const height = Math.max(920, 620 + tableBlockH + 170);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  const sans = '"Plus Jakarta Sans", Arial, sans-serif';
  const mono = '"JetBrains Mono", "Courier New", monospace';

  // Crisp white paper background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Outer framing border
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  ctx.textBaseline = 'alphabetic';
  let y = 76;

  // Top Header Row
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0F172A';
  ctx.font = `500 20px ${sans}`;
  ctx.fillText(`User ID:  ${employee.userId || 'nadeem'}`, margin, y + 4);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#334155';
  ctx.font = `500 19px ${sans}`;
  ctx.fillText('Page 1 of 1', width - margin, y);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#020617';
  ctx.font = `700 28px ${mono}`;
  ctx.fillText('L O A N   D E D U C T I O N   L E D G E R', width / 2, y + 4);

  y += 40;
  ctx.font = `700 21px ${sans}`;
  ctx.fillText('Pay Group:    ACCOUNTS/FINANCE', width / 2, y);

  // Department / Section / Print Date / Repaid %
  y += 58;
  const leftValX = margin + 155;
  const leftLineEnd = margin + Math.round(contentW * 0.46);
  const rightLblX = margin + Math.round(contentW * 0.62);
  const rightValX = rightLblX + 155;

  const drawUnderlinedPair = (
    lbl: string,
    val: string,
    lx: number,
    vx: number,
    lineEnd: number,
    rowY: number,
    valFont: string,
    boldLbl = false
  ) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = boldLbl ? '#020617' : '#1E293B';
    ctx.font = `${boldLbl ? '700' : '500'} 20px ${sans}`;
    ctx.fillText(lbl, lx, rowY);

    ctx.fillStyle = '#020617';
    ctx.font = valFont;
    drawTruncatedText(ctx, val, vx, rowY, lineEnd - vx - 8);

    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(vx, rowY + 8);
    ctx.lineTo(lineEnd, rowY + 8);
    ctx.stroke();
  };

  drawUnderlinedPair(
    'Department:',
    (employee.department || '-').toUpperCase(),
    margin,
    leftValX,
    leftLineEnd,
    y,
    `700 20px ${sans}`
  );
  drawUnderlinedPair(
    'Periods:',
    `${ledger.totalPeriodsCount} Period${ledger.totalPeriodsCount === 1 ? '' : 's'}`,
    rightLblX,
    rightValX,
    width - margin,
    y,
    `700 20px ${mono}`
  );

  y += 44;
  drawUnderlinedPair(
    'Section:',
    (employee.section || '-').toUpperCase(),
    margin,
    leftValX,
    leftLineEnd,
    y,
    `700 20px ${sans}`
  );
  drawUnderlinedPair(
    'Print Date:',
    formatNowTimestamp(),
    rightLblX,
    rightValX,
    width - margin,
    y,
    `400 19px ${mono}`
  );

  // Divider line
  y += 28;
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(margin, y);
  ctx.lineTo(width - margin, y);
  ctx.stroke();

  // Employee Identity Grid
  y += 40;
  drawUnderlinedPair(
    'Emp ID:',
    employee.employeeId || '-',
    margin,
    leftValX,
    leftLineEnd,
    y,
    `500 20px ${mono}`,
    true
  );
  drawUnderlinedPair(
    'Designation:',
    (employee.designation || '-').toUpperCase(),
    rightLblX,
    rightValX,
    width - margin,
    y,
    `500 20px ${sans}`,
    true
  );

  y += 42;
  drawUnderlinedPair(
    'Name:',
    (employee.name || '-').toUpperCase(),
    margin,
    leftValX,
    leftLineEnd,
    y,
    `500 20px ${sans}`,
    true
  );
  drawUnderlinedPair(
    'Father Name:',
    (employee.fatherName || '-').toUpperCase(),
    rightLblX,
    rightValX,
    width - margin,
    y,
    `500 20px ${sans}`,
    true
  );

  // 3-Box Loan Summary Overview Strip
  y += 44;
  const boxGap = 20;
  const boxW = (contentW - boxGap * 2) / 3;
  const boxH = 96;

  const summaryBoxes: {
    label: string;
    value: string;
    bg: string;
    border: string;
    lblColor: string;
    valColor: string;
  }[] = [
    {
      label: 'TOTAL LOAN (OPENING)',
      value: `PKR ${formatCurrency(ledger.openingTotalLoan)}`,
      bg: '#F8FAFC',
      border: '#94A3B8',
      lblColor: '#475569',
      valColor: '#020617',
    },
    {
      label: `TOTAL DEDUCTED (${ledger.deductionPeriodsCount} PERIODS)`,
      value: `- PKR ${formatCurrency(ledger.totalDeductedAllPeriods)}`,
      bg: '#FFF1F2',
      border: '#FDA4AF',
      lblColor: '#9F1239',
      valColor: '#BE123C',
    },
    {
      label: `REMAINING BALANCE (${ledger.repaidPercent.toFixed(0)}% REPAID)`,
      value: `PKR ${formatCurrency(ledger.currentRemainingLoan)}`,
      bg: '#ECFDF5',
      border: '#6EE7B7',
      lblColor: '#065F46',
      valColor: '#047857',
    },
  ];

  summaryBoxes.forEach((b, i) => {
    const bx = margin + i * (boxW + boxGap);
    ctx.fillStyle = b.bg;
    ctx.fillRect(bx, y, boxW, boxH);
    ctx.strokeStyle = b.border;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, y, boxW, boxH);

    ctx.textAlign = 'left';
    ctx.fillStyle = b.lblColor;
    ctx.font = `700 15px ${sans}`;
    ctx.fillText(b.label, bx + 20, y + 32);

    ctx.fillStyle = b.valColor;
    ctx.font = `700 26px ${mono}`;
    ctx.fillText(b.value, bx + 20, y + 72);
  });

  // Period-by-Period Ledger Table
  y += boxH + 34;
  const colWidths = [
    70, // #
    310, // Period ID
    180, // Status
    268, // Period Loan
    268, // Deducted
    contentW - (70 + 310 + 180 + 268 + 268), // Remaining Loan (272)
  ];
  const headers = [
    '#',
    'Period ID',
    'Status',
    'Period Loan (PKR)',
    'Deducted (PKR)',
    'Remaining Loan (PKR)',
  ];

  // Table Header
  const headerH = 46;
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(margin, y, contentW, headerH);
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.8;
  ctx.strokeRect(margin, y, contentW, headerH);

  let cx = margin;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 18px ${sans}`;
  headers.forEach((h, idx) => {
    const w = colWidths[idx];
    if (idx === 0 || idx === 2) {
      ctx.textAlign = 'center';
      ctx.fillText(h, cx + w / 2, y + 29);
    } else if (idx >= 3) {
      ctx.textAlign = 'right';
      ctx.fillText(h, cx + w - 14, y + 29);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(h, cx + 14, y + 29);
    }
    cx += w;
  });

  y += headerH;

  if (ledger.rows.length === 0) {
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(margin, y, contentW, rowH);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(margin, y, contentW, rowH);

    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'center';
    ctx.font = `500 18px ${sans}`;
    ctx.fillText(
      'No loan deduction periods recorded yet.',
      margin + contentW / 2,
      y + 29
    );
    y += rowH;
  } else {
    ledger.rows.forEach((row, rIdx) => {
      ctx.fillStyle = row.isCurrent
        ? '#F0FDFA'
        : rIdx % 2 === 1
        ? '#F8FAFC'
        : '#FFFFFF';
      ctx.fillRect(margin, y, contentW, rowH);

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.4;
      let colX = margin;
      colWidths.forEach((w) => {
        ctx.strokeRect(colX, y, w, rowH);
        colX += w;
      });

      const statusLabel = row.isCurrent
        ? 'Current'
        : row.source === 'manual'
        ? 'Manual'
        : row.source === 'slip'
        ? 'Slip'
        : 'Saved';

      colX = margin;
      // #
      ctx.fillStyle = '#475569';
      ctx.textAlign = 'center';
      ctx.font = `600 18px ${mono}`;
      ctx.fillText(String(rIdx + 1), colX + colWidths[0] / 2, y + 29);
      colX += colWidths[0];

      // Period ID
      ctx.fillStyle = '#020617';
      ctx.textAlign = 'left';
      ctx.font = `700 19px ${mono}`;
      drawTruncatedText(ctx, row.periodId, colX + 14, y + 29, colWidths[1] - 24);
      colX += colWidths[1];

      // Status
      ctx.fillStyle = row.isCurrent ? '#0F766E' : '#475569';
      ctx.textAlign = 'center';
      ctx.font = `600 17px ${sans}`;
      ctx.fillText(statusLabel, colX + colWidths[2] / 2, y + 29);
      colX += colWidths[2];

      // Period Loan
      ctx.fillStyle = '#0F172A';
      ctx.textAlign = 'right';
      ctx.font = `500 19px ${mono}`;
      ctx.fillText(formatCurrency(row.totalLoan), colX + colWidths[3] - 14, y + 29);
      colX += colWidths[3];

      // Deducted
      ctx.fillStyle = '#BE123C';
      ctx.font = `700 19px ${mono}`;
      ctx.fillText(
        `- ${formatCurrency(row.loanDeduction)}`,
        colX + colWidths[4] - 14,
        y + 29
      );
      colX += colWidths[4];

      // Remaining Loan
      ctx.fillStyle = '#020617';
      ctx.font = `700 19px ${mono}`;
      ctx.fillText(
        formatCurrency(row.remainingLoan),
        colX + colWidths[5] - 14,
        y + 29
      );

      y += rowH;
    });
  }

  // Table Totals Row
  const totalRowH = 48;
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(margin, y, contentW, totalRowH);
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2;
  ctx.strokeRect(margin, y, contentW, totalRowH);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#020617';
  ctx.font = `700 19px ${sans}`;
  ctx.fillText(
    `Total (${ledger.totalPeriodsCount} Period${ledger.totalPeriodsCount === 1 ? '' : 's'})`,
    margin + 16,
    y + 31
  );

  const loanColEnd = margin + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
  const dedColEnd = loanColEnd + colWidths[4];
  const remColEnd = margin + contentW;

  ctx.textAlign = 'right';
  ctx.font = `700 19px ${mono}`;
  ctx.fillStyle = '#0F172A';
  ctx.fillText(formatCurrency(ledger.openingTotalLoan), loanColEnd - 14, y + 31);

  ctx.fillStyle = '#BE123C';
  ctx.fillText(
    `- ${formatCurrency(ledger.totalDeductedAllPeriods)}`,
    dedColEnd - 14,
    y + 31
  );

  ctx.fillStyle = '#047857';
  ctx.fillText(formatCurrency(ledger.currentRemainingLoan), remColEnd - 14, y + 31);

  // Signature & Footer
  y += totalRowH + 74;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#475569';
  ctx.font = `500 17px ${sans}`;
  ctx.fillText(
    'Personal Offline Salary & Deduction Ledger · This is not a loan app',
    margin,
    y + 18
  );

  const sigX = margin + Math.round(contentW * 0.66);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#020617';
  ctx.font = `700 19px ${sans}`;
  ctx.fillText('X', sigX, y - 4);

  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sigX, y + 8);
  ctx.lineTo(width - margin, y + 8);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = `700 18px ${sans}`;
  drawTruncatedText(
    ctx,
    (employee.name || 'EMPLOYEE SIGNATURE').toUpperCase(),
    (sigX + width - margin) / 2,
    y + 34,
    width - margin - sigX - 10
  );

  const safeEmpId = (employee.employeeId || 'EMP').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Loan_Ledger_${safeEmpId}.jpg`;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to generate Loan Ledger JPG'))),
      'image/jpeg',
      0.95
    );
  });

  return { blob, dataUrl, filename };
}

export async function downloadLoanLedgerJpg(
  employee: EmployeeDetails,
  ledger: LoanLedgerSummary
): Promise<{
  filename: string;
  dataUrl: string;
  savedToDevice: boolean;
  location: string;
  viaShareSheet?: boolean;
}> {
  const { blob, dataUrl, filename } = await buildLoanLedgerJpg(employee, ledger);
  const saveRes = await saveFileToDevice({
    filename,
    blob,
    base64Data: stripDataUrlPrefix(dataUrl),
  });

  return {
    filename,
    dataUrl,
    savedToDevice: saveRes.savedToDevice,
    location: saveRes.location,
    viaShareSheet: saveRes.viaShareSheet,
  };
}

export async function shareLoanLedgerJpg(
  employee: EmployeeDetails,
  ledger: LoanLedgerSummary
): Promise<{
  filename: string;
  dataUrl: string;
  shared: boolean;
  method: WhatsAppShareResult['method'];
}> {
  const { blob, dataUrl, filename } = await buildLoanLedgerJpg(employee, ledger);
  const text = buildWhatsAppLoanSummaryText(employee, ledger);

  const res = await shareSlipToWhatsApp({
    filename,
    blob,
    base64Data: stripDataUrlPrefix(dataUrl),
    mimeType: 'image/jpeg',
    title: `Loan Ledger - ${employee.name || employee.employeeId || 'Employee'}`,
    text,
  });

  return {
    filename,
    dataUrl,
    shared: res.shared,
    method: res.method,
  };
}

export function buildLoanLedgerPdf(
  employee: EmployeeDetails,
  ledger: LoanLedgerSummary
): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
  const margin = 12;
  const contentWidth = pageWidth - margin * 2; // 186mm
  let y = 14;

  // Top Header
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`User ID:  ${employee.userId || 'nadeem'}`, margin, y + 2);
  doc.text('Page 1 of 1', pageWidth - margin, y, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('L O A N   D E D U C T I O N   L E D G E R', pageWidth / 2, y + 2, {
    align: 'center',
  });

  y += 6.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.text('Pay Group:    ACCOUNTS/FINANCE', pageWidth / 2, y, { align: 'center' });

  // Department / Section / Periods / Print Date
  y += 9;
  const leftValX = margin + 22;
  const leftLineEnd = margin + contentWidth * 0.46;
  const rightLblX = margin + contentWidth * 0.62;
  const rightValX = rightLblX + 20;

  doc.setFontSize(8.5);
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.25);

  doc.setFont('helvetica', 'normal');
  doc.text('Department:', margin, y);
  doc.setFont('helvetica', 'bold');
  doc.text((employee.department || '-').toUpperCase().slice(0, 30), leftValX, y);
  doc.line(leftValX, y + 1.1, leftLineEnd, y + 1.1);

  doc.setFont('helvetica', 'normal');
  doc.text('Periods:', rightLblX, y);
  doc.setFont('courier', 'bold');
  doc.text(
    `${ledger.totalPeriodsCount} Period${ledger.totalPeriodsCount === 1 ? '' : 's'}`,
    rightValX,
    y
  );
  doc.line(rightValX, y + 1.1, pageWidth - margin, y + 1.1);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.text('Section:', margin, y);
  doc.setFont('helvetica', 'bold');
  doc.text((employee.section || '-').toUpperCase().slice(0, 30), leftValX, y);
  doc.line(leftValX, y + 1.1, leftLineEnd, y + 1.1);

  doc.setFont('helvetica', 'normal');
  doc.text('Print Date:', rightLblX, y);
  doc.setFont('courier', 'normal');
  doc.text(formatNowTimestamp(), rightValX, y);
  doc.line(rightValX, y + 1.1, pageWidth - margin, y + 1.1);

  y += 4;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);
  doc.line(margin, y, pageWidth - margin, y);

  // Employee Identity Block
  y += 6.5;
  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.25);

  doc.setFont('helvetica', 'bold');
  doc.text('Emp ID:', margin, y);
  doc.setFont('courier', 'normal');
  doc.text(employee.employeeId || '-', leftValX, y);
  doc.line(leftValX, y + 1.1, leftLineEnd, y + 1.1);

  doc.setFont('helvetica', 'bold');
  doc.text('Designation:', rightLblX, y);
  doc.setFont('helvetica', 'normal');
  doc.text((employee.designation || '-').toUpperCase().slice(0, 26), rightValX, y);
  doc.line(rightValX, y + 1.1, pageWidth - margin, y + 1.1);

  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.text('Name:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text((employee.name || '-').toUpperCase().slice(0, 30), leftValX, y);
  doc.line(leftValX, y + 1.1, leftLineEnd, y + 1.1);

  doc.setFont('helvetica', 'bold');
  doc.text('Father Name:', rightLblX, y);
  doc.setFont('helvetica', 'normal');
  doc.text((employee.fatherName || '-').toUpperCase().slice(0, 26), rightValX, y);
  doc.line(rightValX, y + 1.1, pageWidth - margin, y + 1.1);

  // 3 Summary Boxes
  y += 7;
  const boxGap = 3.5;
  const boxW = (contentWidth - boxGap * 2) / 3;
  const boxH = 14;

  const boxes: {
    label: string;
    value: string;
    fill: [number, number, number];
    border: [number, number, number];
    text: [number, number, number];
  }[] = [
    {
      label: 'TOTAL LOAN (OPENING)',
      value: `PKR ${formatCurrency(ledger.openingTotalLoan)}`,
      fill: [248, 250, 252],
      border: [148, 163, 184],
      text: [15, 23, 42],
    },
    {
      label: `TOTAL DEDUCTED (${ledger.deductionPeriodsCount} PERIODS)`,
      value: `- PKR ${formatCurrency(ledger.totalDeductedAllPeriods)}`,
      fill: [255, 241, 242],
      border: [253, 164, 175],
      text: [190, 18, 60],
    },
    {
      label: `REMAINING (${ledger.repaidPercent.toFixed(0)}% REPAID)`,
      value: `PKR ${formatCurrency(ledger.currentRemainingLoan)}`,
      fill: [236, 253, 245],
      border: [110, 231, 183],
      text: [4, 120, 87],
    },
  ];

  boxes.forEach((b, i) => {
    const bx = margin + i * (boxW + boxGap);
    doc.setFillColor(...b.fill);
    doc.setDrawColor(...b.border);
    doc.setLineWidth(0.3);
    doc.rect(bx, y, boxW, boxH, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(...b.text);
    doc.text(b.label, bx + 2.5, y + 4.8);

    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.text(b.value, bx + 2.5, y + 10.8);
  });

  // Table
  y += boxH + 6;
  const colW = [10, 44, 24, 36, 36, contentWidth - (10 + 44 + 24 + 36 + 36)];
  const headers = [
    '#',
    'Period ID',
    'Status',
    'Period Loan (PKR)',
    'Deducted (PKR)',
    'Remaining Loan (PKR)',
  ];
  const headerH = 7;
  const rowH = 6.5;

  const drawTableHeader = (startY: number) => {
    doc.setFillColor(15, 23, 42);
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.3);
    doc.rect(margin, startY, contentWidth, headerH, 'FD');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.8);

    let cx = margin;
    headers.forEach((h, idx) => {
      const w = colW[idx];
      if (idx === 0 || idx === 2) {
        doc.text(h, cx + w / 2, startY + 4.7, { align: 'center' });
      } else if (idx >= 3) {
        doc.text(h, cx + w - 2, startY + 4.7, { align: 'right' });
      } else {
        doc.text(h, cx + 2, startY + 4.7);
      }
      cx += w;
    });
    return startY + headerH;
  };

  y = drawTableHeader(y);

  if (ledger.rows.length === 0) {
    doc.setDrawColor(51, 65, 85);
    doc.setLineWidth(0.25);
    doc.rect(margin, y, contentWidth, rowH);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('No loan deduction periods recorded yet.', margin + contentWidth / 2, y + 4.5, {
      align: 'center',
    });
    y += rowH;
  } else {
    ledger.rows.forEach((row, idx) => {
      if (y + rowH > pageHeight - 28) {
        doc.addPage();
        y = 14;
        y = drawTableHeader(y);
      }

      if (row.isCurrent) {
        doc.setFillColor(240, 253, 250);
      } else if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
      } else {
        doc.setFillColor(255, 255, 255);
      }
      doc.rect(margin, y, contentWidth, rowH, 'F');

      doc.setDrawColor(71, 85, 105);
      doc.setLineWidth(0.2);
      let cx = margin;
      colW.forEach((w) => {
        doc.rect(cx, y, w, rowH);
        cx += w;
      });

      const statusLabel = row.isCurrent
        ? 'Current'
        : row.source === 'manual'
        ? 'Manual'
        : row.source === 'slip'
        ? 'Slip'
        : 'Saved';

      cx = margin;
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(71, 85, 105);
      doc.text(String(idx + 1), cx + colW[0] / 2, y + 4.4, { align: 'center' });
      cx += colW[0];

      doc.setFont('courier', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(row.periodId.slice(0, 20), cx + 2, y + 4.4);
      cx += colW[1];

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(row.isCurrent ? 15 : 71, row.isCurrent ? 118 : 85, row.isCurrent ? 110 : 105);
      doc.text(statusLabel, cx + colW[2] / 2, y + 4.4, { align: 'center' });
      cx += colW[2];

      doc.setFont('courier', 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(formatCurrency(row.totalLoan), cx + colW[3] - 2, y + 4.4, { align: 'right' });
      cx += colW[3];

      doc.setFont('courier', 'bold');
      doc.setTextColor(190, 18, 60);
      doc.text(`- ${formatCurrency(row.loanDeduction)}`, cx + colW[4] - 2, y + 4.4, {
        align: 'right',
      });
      cx += colW[4];

      doc.setTextColor(15, 23, 42);
      doc.text(formatCurrency(row.remainingLoan), cx + colW[5] - 2, y + 4.4, { align: 'right' });

      y += rowH;
    });
  }

  // Totals Row
  if (y + 24 > pageHeight - 12) {
    doc.addPage();
    y = 14;
  }

  const totalH = 7.5;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.35);
  doc.rect(margin, y, contentWidth, totalH, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Total (${ledger.totalPeriodsCount} Period${ledger.totalPeriodsCount === 1 ? '' : 's'})`,
    margin + 2.5,
    y + 5.1
  );

  const loanColEnd = margin + colW[0] + colW[1] + colW[2] + colW[3];
  const dedColEnd = loanColEnd + colW[4];
  const remColEnd = margin + contentWidth;

  doc.setFont('courier', 'bold');
  doc.text(formatCurrency(ledger.openingTotalLoan), loanColEnd - 2, y + 5.1, {
    align: 'right',
  });
  doc.setTextColor(190, 18, 60);
  doc.text(`- ${formatCurrency(ledger.totalDeductedAllPeriods)}`, dedColEnd - 2, y + 5.1, {
    align: 'right',
  });
  doc.setTextColor(4, 120, 87);
  doc.text(formatCurrency(ledger.currentRemainingLoan), remColEnd - 2, y + 5.1, {
    align: 'right',
  });

  // Footer & Signature
  y += totalH + 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Personal Offline Salary & Deduction Ledger · This is not a loan app', margin, y + 4);

  const sigX = margin + contentWidth * 0.66;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('X', sigX, y);
  doc.setLineWidth(0.3);
  doc.line(sigX, y + 2, pageWidth - margin, y + 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.text((employee.name || 'EMPLOYEE').toUpperCase(), (sigX + pageWidth - margin) / 2, y + 6.5, {
    align: 'center',
  });

  const safeEmpId = (employee.employeeId || 'EMP').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Loan_Ledger_${safeEmpId}.pdf`;

  return { doc, filename };
}

export async function downloadLoanLedgerPdf(
  employee: EmployeeDetails,
  ledger: LoanLedgerSummary
): Promise<{
  filename: string;
  savedToDevice: boolean;
  location: string;
  viaShareSheet?: boolean;
}> {
  const { doc, filename } = buildLoanLedgerPdf(employee, ledger);
  const blob = doc.output('blob');
  const dataUri = doc.output('datauristring');
  const res = await saveFileToDevice({
    filename,
    blob,
    base64Data: stripDataUrlPrefix(dataUri),
  });
  return {
    filename,
    savedToDevice: res.savedToDevice,
    location: res.location,
    viaShareSheet: res.viaShareSheet,
  };
}
