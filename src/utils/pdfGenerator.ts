import { jsPDF } from 'jspdf';
import type {
  AttendanceDay,
  EmployeeDetails,
  PayrollSummary,
  SalaryAndLoanConfig,
} from '../types/payroll';
import { saveFileToDevice, stripDataUrlPrefix } from './nativeFileHelper';
import { formatCurrency, formatHours } from './salaryMath';

function formatNowTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

export function buildSalarySlipPdf(
  employee: EmployeeDetails,
  config: SalaryAndLoanConfig,
  attendance: AttendanceDay[],
  summary: PayrollSummary
): { doc: jsPDF; filename: string } {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const margin = 15;
  const contentWidth = pageWidth - margin * 2; // 180mm
  let y = 12;

  // Top Header Row: User ID | SALARY PAYMENT [DETAIL] | Page 1 of 1
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(`User ID:  ${employee.userId || 'nadeem'}`, margin, y + 3);
  doc.text('Page 1 of 1', pageWidth - margin, y, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text('SALARY PAYMENT [DETAIL]', pageWidth / 2, y + 2, {
    align: 'center',
    charSpace: 1.0,
  });

  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.text(
    'Pay Group:    ACCOUNTS/FINANCE',
    pageWidth / 2,
    y,
    { align: 'center' }
  );

  // Department / Section (~46%) + open gap + Period ID / Print Date (~35%)
  y += 10;
  const leftValX = margin + 22;
  const leftLineEnd = margin + contentWidth * 0.46; // ~87.4mm
  const rightLblX = margin + contentWidth * 0.65; // ~123.5mm
  const rightValX = rightLblX + 19;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Department:', margin, y);
  doc.setFont('helvetica', 'bold');
  doc.text((employee.department || '-').toUpperCase(), leftValX, y);
  doc.setDrawColor(120, 120, 120);
  doc.setLineWidth(0.25);
  doc.line(leftValX, y + 1.2, leftLineEnd, y + 1.2);

  doc.setFont('helvetica', 'normal');
  doc.text('Period ID:', rightLblX, y);
  doc.setFont('courier', 'bold');
  doc.text(config.periodId || '01-15', (rightValX + pageWidth - margin) / 2, y, {
    align: 'center',
  });
  doc.line(rightValX, y + 1.2, pageWidth - margin, y + 1.2);

  y += 6.2;
  doc.setFont('helvetica', 'normal');
  doc.text('Section:', margin, y);
  doc.setFont('helvetica', 'bold');
  doc.text((employee.section || '-').toUpperCase(), leftValX, y);
  doc.line(leftValX, y + 1.2, leftLineEnd, y + 1.2);

  doc.setFont('helvetica', 'normal');
  doc.text('Print Date:', rightLblX, y);
  doc.setFont('courier', 'normal');
  doc.text(formatNowTimestamp(), (rightValX + pageWidth - margin) / 2, y, {
    align: 'center',
  });
  doc.line(rightValX, y + 1.2, pageWidth - margin, y + 1.2);

  y += 4;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);
  doc.line(margin, y, pageWidth - margin, y);

  // Main Middle Block: Left Employee Info (~51%) | Center Hours Table (~29%) | Right Photo Box (~14.5%)
  const blockTop = y + 4.5;
  const empEndX = margin + contentWidth * 0.51; // ~96.9mm

  // Left block header: Transfer To Bank / Cash | Regular or Daily Wages
  const isCashPayment = employee.bankAccountEnabled === false;
  const employmentLabel =
    (summary.employmentType ?? config.employmentType) === 'daily_wages'
      ? 'Daily Wages'
      : 'Regular';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(isCashPayment ? 'Cash' : 'Transfer To Bank', margin, blockTop);
  doc.text(employmentLabel, empEndX, blockTop, { align: 'right' });

  let empY = blockTop + 5.6;
  doc.setFontSize(8.5);

  doc.setFont('helvetica', 'bold');
  doc.text('Emp ID:', margin, empY);
  doc.setFont('courier', 'normal');
  doc.text(employee.employeeId || '-', margin + 23, empY);

  // Regular Pay underlined right of Emp ID
  doc.text(formatCurrency(summary.regularPay), empEndX - 0.5, empY, { align: 'right' });
  doc.setLineWidth(0.25);
  doc.line(empEndX - 21, empY + 1, empEndX, empY + 1);

  empY += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Name:', margin, empY);
  doc.setFont('helvetica', 'normal');
  doc.text((employee.name || '-').toUpperCase().slice(0, 34), margin + 23, empY);

  empY += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Father Name:', margin, empY);
  doc.setFont('helvetica', 'normal');
  doc.text((employee.fatherName || '-').toUpperCase().slice(0, 34), margin + 23, empY);

  empY += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Designation:', margin, empY);
  doc.setFont('helvetica', 'normal');
  doc.text((employee.designation || '-').toUpperCase().slice(0, 34), margin + 23, empY);

  // Center Table (~29% of contentWidth): Detail | Hours | Days
  const tblX = empEndX + contentWidth * 0.025;
  const tblW = contentWidth * 0.29; // ~55.1mm
  const cW = [tblW * 0.36, tblW * 0.32, tblW * 0.32];
  const tblStartY = blockTop - 2.3;
  const tblTargetH = empY - tblStartY + 1.0;
  const rH = tblTargetH / 5;
  let tblY = tblStartY;

  const totalLeaveHours = summary.totalLeaveHours ?? 0;
  const earnedAllowance = summary.earnedAllowance ?? summary.allowances ?? 0;

  const tblRows: [string, string, string, boolean][] = [
    ['Detail', 'Hours', 'Days', true],
    ['W. Hrs:', formatHours(summary.totalRegularHours), (summary.totalRegularHours / 8).toFixed(2), false],
    ['L. Hrs:', formatHours(totalLeaveHours), (totalLeaveHours / 8).toFixed(2), false],
    ['OT. Hrs:', formatHours(summary.totalOtHours), (summary.totalOtHours / 8).toFixed(2), false],
    ['Total:', formatHours(summary.totalHours), summary.equivalentDays.toFixed(2), true],
  ];

  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.3);
  tblRows.forEach(([c1, c2, c3, isBold], idx) => {
    doc.rect(tblX, tblY, cW[0], rH);
    doc.rect(tblX + cW[0], tblY, cW[1], rH);
    doc.rect(tblX + cW[0] + cW[1], tblY, cW[2], rH);

    doc.setFontSize(8);
    if (idx === 0) {
      doc.setFont('helvetica', 'bold');
      doc.text(c1, tblX + cW[0] / 2, tblY + rH * 0.68, { align: 'center' });
      doc.text(c2, tblX + cW[0] + cW[1] / 2, tblY + rH * 0.68, { align: 'center' });
      doc.text(c3, tblX + cW[0] + cW[1] + cW[2] / 2, tblY + rH * 0.68, { align: 'center' });
    } else {
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      doc.text(c1, tblX + 1.5, tblY + rH * 0.68);

      doc.setFont('courier', isBold ? 'bold' : 'normal');
      doc.text(c2, tblX + cW[0] + cW[1] - 1.5, tblY + rH * 0.68, { align: 'right' });
      doc.text(c3, tblX + tblW - 1.5, tblY + rH * 0.68, { align: 'right' });
    }
    tblY += rH;
  });

  // Far Right Photo Box (~14.5% of contentWidth, matching table height)
  const photoW = contentWidth * 0.145;
  const photoH = rH * 5;
  const photoX = pageWidth - margin - photoW;
  const photoY = tblStartY;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.35);
  doc.rect(photoX, photoY, photoW, photoH);
  if (employee.photoDataUrl && employee.photoDataUrl.startsWith('data:image')) {
    try {
      doc.addImage(employee.photoDataUrl, 'JPEG', photoX + 0.5, photoY + 0.5, photoW - 1, photoH - 1);
    } catch {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.text('PHOTO', photoX + photoW / 2, photoY + photoH / 2, { align: 'center' });
    }
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 120);
    doc.text('PHOTO', photoX + photoW / 2, photoY + photoH / 2, { align: 'center' });
    doc.setTextColor(15, 23, 42);
  }

  // Horizontal Financial Row (Proportional Voucher Spacing: 22% | 14% | 22% | 21% | 21%)
  y = Math.max(empY, tblY, photoY + photoH) + 5.8;
  doc.setFontSize(8.2);
  doc.setLineWidth(0.25);

  const gapFin = 2.2;
  const usableFin = contentWidth - gapFin * 4;
  const finWeights = [0.22, 0.14, 0.22, 0.21, 0.21];
  const finSpecs: [string, string, boolean][] = [
    ['Gross Salary:', formatCurrency(summary.grossSalary), true],
    ['Allw.', formatCurrency(earnedAllowance), true],
    ['Ded.Adv:', formatCurrency(summary.advanceDeduction), true],
    ['Ded.Loan:', formatCurrency(summary.loanDeduction), true],
    ['Ded.Oth:', formatCurrency(summary.otherDeduction), true],
  ];

  let finCursor = margin;
  finSpecs.forEach(([lbl, val, boldLbl], idx) => {
    const segW = usableFin * finWeights[idx];
    const startX = finCursor;
    const endX = idx === finSpecs.length - 1 ? pageWidth - margin : startX + segW;

    doc.setFont('helvetica', boldLbl ? 'bold' : 'normal');
    doc.text(lbl, startX, y);
    const lineStart = startX + doc.getTextWidth(lbl) + 1.2;
    doc.setFont('courier', 'normal');
    doc.text(val, endX - 1, y, { align: 'right' });
    doc.line(lineStart, y + 1, endX, y + 1);

    finCursor = endX + gapFin;
  });

  y += 6.2;

  // Bank Account Row (34% | 2% gap | 21% | 4% gap | 39%)
  if (!isCashPayment) {
    const accEnd = margin + contentWidth * 0.34;
    const brStart = margin + contentWidth * 0.36;
    const brEnd = margin + contentWidth * 0.57;
    const bNameStart = margin + contentWidth * 0.61;

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.text('Account No:', margin, y);
    doc.setFont('courier', 'normal');
    doc.text(employee.accountNo || '-', margin + 19.5, y);
    doc.line(margin + 18.5, y + 1, accEnd, y + 1);

    doc.setFont('helvetica', 'normal');
    doc.text('Branch No,:', brStart, y);
    doc.setFont('courier', 'normal');
    doc.text(employee.branchNo || '-', brStart + 18.5, y);
    doc.line(brStart + 17.5, y + 1, brEnd, y + 1);

    doc.setFont('helvetica', 'normal');
    doc.text('Branch Name:', bNameStart, y);
    doc.setFont('helvetica', 'normal');
    doc.text((employee.bankName || '-').toUpperCase(), bNameStart + 22, y);
    doc.line(bNameStart + 21, y + 1, pageWidth - margin, y + 1);
    y += 5.5;
  }

  // Net Salary & Thumb 2-Compartment Box + Signature
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Net Salary & Thumb:', margin, y + 8.5);

  const boxX = margin + 35;
  const halfBoxW = 34;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.45);
  doc.rect(boxX, y, halfBoxW, 14);
  doc.rect(boxX + halfBoxW, y, halfBoxW, 14);

  doc.setFont('courier', 'bold');
  doc.setFontSize(11.5);
  doc.text(formatCurrency(summary.netSalary), boxX + halfBoxW / 2, y + 8.5, { align: 'center' });

  const sigX = margin + contentWidth * 0.67;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('X', sigX, y + 5.5);
  doc.setLineWidth(0.3);
  doc.line(sigX, y + 7.5, pageWidth - margin, y + 7.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text((employee.name || 'EMPLOYEE').toUpperCase(), (sigX + pageWidth - margin) / 2, y + 12, {
    align: 'center',
  });

  // Bottom 2-Band 16-Slot Attendance Detail Grid (12% label | 8 x 11% days)
  y += 19;
  const labelColW = contentWidth * 0.12;
  const dayColW = (contentWidth - labelColW) / 8;
  const hDay = 4.8;
  const hSub = 4.4;
  const hTime = 7.2;
  const bandH = hDay + hSub + hTime;

  const drawBand = (daysSlice: AttendanceDay[], bandY: number) => {
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.3);

    // Left merged Attendance Detail cell
    doc.rect(margin, bandY, labelColW, bandH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Attendance', margin + labelColW / 2, bandY + bandH / 2 - 1, {
      align: 'center',
    });
    doc.text('Detail', margin + labelColW / 2, bandY + bandH / 2 + 3, {
      align: 'center',
    });

    for (let i = 0; i < 8; i++) {
      const cx = margin + labelColW + i * dayColW;
      const day = daysSlice[i];

      // Full day column outer box
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.3);
      doc.rect(cx, bandY, dayColW, bandH);

      // Framed inset T. IN / T. OUT sub-boxes
      doc.setDrawColor(71, 85, 105);
      doc.setLineWidth(0.2);
      doc.rect(cx + 0.5, bandY + hDay + 0.3, dayColW / 2 - 0.8, hSub - 0.6);
      doc.rect(cx + dayColW / 2 + 0.3, bandY + hDay + 0.3, dayColW / 2 - 0.8, hSub - 0.6);

      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(5.8);
      doc.text('T. IN', cx + dayColW * 0.25, bandY + hDay + 3.1, { align: 'center' });
      doc.text('T. OUT', cx + dayColW * 0.75, bandY + hDay + 3.1, { align: 'center' });

      if (!day) {
        continue;
      }

      doc.setFont('courier', 'bold');
      doc.setFontSize(8);
      doc.text(day.dateLabel, cx + dayColW / 2, bandY + 3.6, { align: 'center' });

      const isOffLabel =
        (day.dayType === 'sunday' ||
          day.dayType === 'holiday' ||
          day.dayType === 'leave' ||
          day.dayType === 'absent') &&
        (!day.inTime || !day.outTime);

      if (isOffLabel) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(day.dayType === 'leave' ? 6.6 : 7.8);
        const label =
          day.dayType === 'leave'
            ? 'Sick Leave'
            : day.dayType.charAt(0).toUpperCase() + day.dayType.slice(1);
        doc.text(label, cx + dayColW / 2, bandY + hDay + hSub + 5, {
          align: 'center',
        });
      } else {
        if (
          (day.dayType === 'sunday' || day.dayType === 'holiday') &&
          day.inTime &&
          day.outTime
        ) {
          const cellTop = bandY + hDay + hSub;
          const workedOffLabel =
            day.dayType === 'holiday' ? 'Holiday' : 'Sunday';
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(6.2);
          doc.setTextColor(51, 65, 85);
          doc.text(workedOffLabel, cx + dayColW / 2, cellTop + 2.7, {
            align: 'center',
          });
          doc.setTextColor(15, 23, 42);
          doc.setFont('courier', 'bold');
          doc.setFontSize(6.8);
          doc.text(day.inTime || '--:--', cx + dayColW * 0.25, cellTop + 6.0, {
            align: 'center',
          });
          doc.text(day.outTime || '--:--', cx + dayColW * 0.75, cellTop + 6.0, {
            align: 'center',
          });
        } else {
          doc.setFont('courier', 'normal');
          doc.setFontSize(7.2);
          doc.text(day.inTime || '--:--', cx + dayColW * 0.25, bandY + hDay + hSub + 5, {
            align: 'center',
          });
          doc.text(day.outTime || '--:--', cx + dayColW * 0.75, bandY + hDay + hSub + 5, {
            align: 'center',
          });
        }
      }
    }
  };

  drawBand(attendance.slice(0, 8), y);
  drawBand(attendance.slice(8, 15), y + bandH);

  const safeEmpId = (employee.employeeId || 'EMP').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safePeriod = (config.periodId || '15DAYS').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Salary_Slip_${safeEmpId}_${safePeriod}.pdf`;

  return { doc, filename };
}

export async function downloadSalarySlipPdf(
  employee: EmployeeDetails,
  config: SalaryAndLoanConfig,
  attendance: AttendanceDay[],
  summary: PayrollSummary
): Promise<{ filename: string; savedToDevice: boolean; location: string; viaShareSheet?: boolean }> {
  const { doc, filename } = buildSalarySlipPdf(employee, config, attendance, summary);
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
