import React from 'react';
import QRCode from 'qrcode.react';

export function MirrorQrCode({ value, size = 256, className = '' }) {
  if (!value) return null;
  return (
    <div className={`mirror-qr-code ${className}`.trim()}>
      <QRCode value={value} size={size} renderAs="svg" />
    </div>
  );
}
