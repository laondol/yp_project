import smtplib
import ssl
import os
import base64
from email.mime.text import MIMEText
from flask import current_app

_DEV_MODE = os.environ.get('DEV_MODE') == '1'

class EmailService:
    @staticmethod
    def send(to, subject, body):
        if _DEV_MODE:
            print(f"[DEV EMAIL] To: {to}")
            print(f"[DEV EMAIL] Subject: {subject}")
            print(f"[DEV EMAIL] Body:\\n{body}")
            print(f"[DEV EMAIL] ---")
            return True

        smtp_host = current_app.config.get('SMTP_HOST')
        smtp_port = int(current_app.config.get('SMTP_PORT', 587))
        smtp_user = current_app.config.get('SMTP_USERNAME')
        smtp_pass = current_app.config.get('SMTP_PASSWORD')
        from_addr = current_app.config.get('MAIL_FROM', 'yp@unocum.kr')

        if not smtp_user or not smtp_pass:
            current_app.logger.warning(f"SMTP 미설정: {subject} → {to}")
            print(f"[EMAIL] To: {to}, Subject: {subject}")
            return False

        msg = MIMEText(body, 'plain', 'utf-8')
        msg['Subject'] = subject
        msg['From'] = from_addr
        msg['To'] = to

        # 1) TLS 시도
        if smtp_port != 25:
            try:
                use_ssl = (smtp_port == 465)
                if use_ssl:
                    ctx = ssl.create_default_context()
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                    server = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=5, context=ctx)
                else:
                    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                    ctx.check_hostname = False
                    ctx.verify_mode = ssl.CERT_NONE
                    if hasattr(ssl, 'OP_LEGACY_SERVER_CONNECT'):
                        ctx.options |= ssl.OP_LEGACY_SERVER_CONNECT
                    ctx.set_ciphers('DEFAULT:@SECLEVEL=0')
                    server = smtplib.SMTP(smtp_host, smtp_port, timeout=5)
                    server.starttls(context=ctx)
                server.login(smtp_user, smtp_pass)
                server.sendmail(from_addr, [to], msg.as_string())
                server.quit()
                current_app.logger.info(f"Email sent (TLS): {subject} → {to}")
                return True
            except Exception as e:
                current_app.logger.warning(f"TLS failed, trying plain: {e}")

        # 2) TLS 실패 시 일반 AUTH 시도 (port 25)
        try:
            server = smtplib.SMTP(smtp_host, 25, timeout=10)
            server.ehlo()
            auth_str = f'\x00{smtp_user}\x00{smtp_pass}'
            code, _ = server.docmd('AUTH', 'PLAIN ' + base64.b64encode(auth_str.encode()).decode())
            if code != 235:
                raise Exception(f'AUTH failed: {code}')
            server.sendmail(from_addr, [to], msg.as_string())
            server.quit()
            current_app.logger.info(f"Email sent (plain): {subject} → {to}")
            return True
        except Exception as e:
            current_app.logger.error(f"Email failed: {e}")
            print(f"[EMAIL FAIL] {subject} → {to}: {e}")
            return False
