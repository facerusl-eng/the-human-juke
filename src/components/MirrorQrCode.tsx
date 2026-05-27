import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
interface MirrorQrCodeProps {
  value: string;
  size?: number;
  className?: string;
}

export function MirrorQrCode({ value, size = 256, className = '' }: MirrorQrCodeProps) {
  if (!value) return null;
  return (
    <div className={`mirror-qr-code ${className}`.trim()}>
      <QRCodeSVG value={value} size={size} />
    </div>
  );
}
