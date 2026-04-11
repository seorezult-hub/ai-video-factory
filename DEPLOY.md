# Деплой на Beget VPS

1. SSH на сервер
2. cd /opt/video-service (или где лежит проект)
3. Создать .env: cp env.example .env и заполнить ключами
4. bash deploy.sh
5. Проверить: curl https://video.koyiequoquulee.beget.app/api/health
