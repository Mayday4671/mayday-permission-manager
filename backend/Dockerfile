FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.m2 mvn -B package
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S mayday && adduser -S mayday -G mayday \
    && mkdir -p /app/data/files && chown -R mayday:mayday /app/data
USER mayday
COPY --from=build /app/mayday-application/target/mayday-application-1.0.0.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
