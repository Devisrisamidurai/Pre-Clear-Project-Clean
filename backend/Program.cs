using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Amazon.S3;
using Microsoft.Extensions.Options;
using PreClear.Api.Data;
using PreClear.Api.Swagger;
using PreClear.Api.Models;
using Amazon.Textract;
using Amazon.BedrockRuntime;
using PreClear.Api.AI.Services.DocumentValidator;
using PreClear.Api.Interfaces;
using PreClear.Api.Services;


var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        // Use camelCase for JSON property names (default in ASP.NET Core)
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        // Make enum parsing case-insensitive and use string converter
        options.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
        // Don't preserve references - use ReferenceHandler.IgnoreCycles instead to handle circular refs gracefully
        options.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
        options.JsonSerializerOptions.WriteIndented = true;
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo
    {
        Title = "PreClear API",
        Version = "v1",
        Description = "AI-powered customs compliance platform with JWT authentication"
    });

    c.OperationFilter<FileUploadOperationFilter>(); // ✅ IMPORTANT

    // Add JWT Bearer authentication to Swagger
    c.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
        Scheme = "Bearer",
        BearerFormat = "JWT",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Description = "JWT Authorization header using the Bearer scheme.\n\n" +
                      "Enter 'Bearer' [space] and then your token in the text input below.\n\n" +
                      "Example: \"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...\""
    });

    // Add security requirement to all endpoints
    c.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        {
            new Microsoft.OpenApi.Models.OpenApiSecurityScheme
            {
                Reference = new Microsoft.OpenApi.Models.OpenApiReference
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            new string[] { }
        }
    });
});


// application services
builder.Services.AddScoped<PreClear.Api.Interfaces.IAuthService, PreClear.Api.Services.AuthService>();
builder.Services.AddScoped<PreClear.Api.Interfaces.IChatService, PreClear.Api.Services.ChatService>();
builder.Services.AddScoped<PreClear.Api.Interfaces.IAiService, PreClear.Api.Services.AiService>();
builder.Services.AddScoped<PreClear.Api.Interfaces.IAiRepository, PreClear.Api.Repositories.AiRepository>();
builder.Services.AddScoped<PreClear.Api.Interfaces.IShipmentRepository, PreClear.Api.Repositories.ShipmentRepository>();
builder.Services.AddScoped<PreClear.Api.Interfaces.IShipmentService, PreClear.Api.Services.ShipmentService>();
builder.Services.AddScoped<PreClear.Api.Interfaces.IDocumentRepository, PreClear.Api.Repositories.DocumentRepository>();
builder.Services.AddScoped<PreClear.Api.Interfaces.IDocumentService, PreClear.Api.Services.DocumentService>();
builder.Services.AddScoped<PreClear.Api.Interfaces.INotificationService, PreClear.Api.Services.NotificationService>();
builder.Services.AddScoped<PreClear.Api.Interfaces.IS3StorageService, PreClear.Api.Services.S3StorageService>();
builder.Services.AddScoped<PreClear.Api.Services.BrokerAssignmentService>(); // Add BrokerAssignmentService
builder.Services.AddTransient<PreClear.Api.Interfaces.IEmailService, PreClear.Api.Services.EmailService>();
builder.Services.AddHttpContextAccessor(); // Add IHttpContextAccessor for JWT claims extraction

// Document Validation Services
builder.Services.AddScoped<ComplianceDatasetLoader>();
builder.Services.AddScoped<DocumentExtractor>();
builder.Services.AddScoped<DocumentValidator>();
builder.Services.AddScoped<IDocumentValidationService, DocumentValidationService>();
builder.Services.AddScoped<IAiDocumentAnalyzer, AiDocumentAnalyzerBedrock>();

// AWS Textract Service
builder.Services.AddScoped<backend.Interfaces.ITextractService, backend.Services.TextractService>();

// AWS S3 Configuration
// AWS S3 Configuration - prefer user-secrets under "AWSS3" but fall back to "AwsS3Settings"
builder.Services.Configure<AwsS3Settings>(builder.Configuration.GetSection("AwsS3Settings"));
builder.Services.AddSingleton(typeof(IAmazonS3), sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var s3Settings = sp.GetService<IOptions<AwsS3Settings>>()?.Value ?? new AwsS3Settings();

    var accessKey = config["AWSS3:AccessKey"] ?? config["AwsS3Settings:AccessKey"] ?? s3Settings.AccessKey;
    var secretKey = config["AWSS3:SecretKey"] ?? config["AwsS3Settings:SecretKey"] ?? s3Settings.SecretKey;
    var region = config["AWSS3:Region"] ?? config["AwsS3Settings:Region"] ?? s3Settings.Region ?? "us-east-1";

    if (string.IsNullOrWhiteSpace(accessKey) || string.IsNullOrWhiteSpace(secretKey))
    {
        throw new InvalidOperationException("AWS S3 credentials are not configured. Set them in user secrets (AWSS3:AccessKey / AWSS3:SecretKey) or in configuration (AwsS3Settings).");
    }

    return new AmazonS3Client(
        accessKey,
        secretKey,
        Amazon.RegionEndpoint.GetBySystemName(region)
    );
});

// AWS Textract Configuration
builder.Services.AddSingleton(typeof(IAmazonTextract), sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var s3Settings = sp.GetService<IOptions<AwsS3Settings>>()?.Value ?? new AwsS3Settings();

    var accessKey = config["AWSS3:AccessKey"] ?? config["AwsS3Settings:AccessKey"] ?? s3Settings.AccessKey;
    var secretKey = config["AWSS3:SecretKey"] ?? config["AwsS3Settings:SecretKey"] ?? s3Settings.SecretKey;
    var region = config["AWS:Region"] ?? config["AwsS3Settings:Region"] ?? s3Settings.Region ?? "us-east-1";

    if (string.IsNullOrWhiteSpace(accessKey) || string.IsNullOrWhiteSpace(secretKey))
    {
        throw new InvalidOperationException("AWS Textract credentials are not configured. Set them in user secrets (AWSS3:AccessKey / AWSS3:SecretKey) or in configuration (AwsS3Settings).");
    }

    return new AmazonTextractClient(
        accessKey,
        secretKey,
        Amazon.RegionEndpoint.GetBySystemName(region)
    );
});

// AWS Bedrock Runtime Configuration
builder.Services.Configure<BedrockSettings>(builder.Configuration.GetSection("Bedrock"));
builder.Services.AddSingleton(typeof(IAmazonBedrockRuntime), sp =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var bedrock = sp.GetService<IOptions<BedrockSettings>>()?.Value ?? new BedrockSettings();
    var region = bedrock.Region ?? config["AWS:Region"] ?? "us-east-1";
    return new AmazonBedrockRuntimeClient(Amazon.RegionEndpoint.GetBySystemName(region));
});

// Connection
var conn = builder.Configuration.GetConnectionString("DefaultConnection");

if (string.IsNullOrWhiteSpace(conn))
    throw new InvalidOperationException("Please set DefaultConnection in appsettings.json");

// EF Core 8 + Pomelo (MySQL)
builder.Services.AddDbContext<PreclearDbContext>(options =>
    options.UseMySql(conn, ServerVersion.AutoDetect(conn),
        mySqlOptions => mySqlOptions.EnableRetryOnFailure()
    )
);

// Log which connection string is being used (mask password) to help troubleshooting
var effectiveConn = builder.Configuration.GetConnectionString("DefaultConnection");
if (!string.IsNullOrWhiteSpace(effectiveConn))
{
    try
    {
        // mask password value for logging
        var masked = System.Text.RegularExpressions.Regex.Replace(effectiveConn, "(Password=)([^;]+)", "$1****", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        builder.Logging.AddConsole();
        Console.WriteLine($"Using DB connection: {masked}");
    }
    catch { }
}

// CORS (dev)
builder.Services.AddCors(p => p.AddDefaultPolicy(q => 
    q.WithOrigins("http://localhost:3000") // specify your frontend URL
     .AllowAnyHeader()
     .AllowAnyMethod()
     .AllowCredentials() // required for cookies/auth
));

// HttpClient factory for AI service outgoing calls
builder.Services.AddHttpClient();

// JWT Authentication
builder.Services.AddAuthentication("Bearer").AddJwtBearer(options =>
{
    var jwtSecret = builder.Configuration["Jwt:Key"] ?? throw new InvalidOperationException("Jwt:Key is not configured");
    var key = System.Text.Encoding.ASCII.GetBytes(jwtSecret);
    
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(key),
        ValidateIssuer = false,  // Disabled for debugging
        ValidateAudience = false,  // Disabled for debugging
        ValidateLifetime = true,
        ClockSkew = TimeSpan.Zero
    };
});

builder.Services.AddAuthorization();

var app = builder.Build();

// Apply migrations automatically in Development only
try
{
    using (var scope = app.Services.CreateScope())
    {
        var env = scope.ServiceProvider.GetRequiredService<IHostEnvironment>();
        if (env.IsDevelopment())
        {
            try
            {
                var db = scope.ServiceProvider.GetRequiredService<PreclearDbContext>();
                // Apply EF Core migrations to update schema without dropping data
                db.Database.Migrate();
                PreClear.Api.Services.DbSeeder.Seed(db);
                Console.WriteLine("Database migrations and seeding completed successfully");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error during database migration/seeding: {ex.Message}");
                Console.WriteLine($"Stack trace: {ex.StackTrace}");
                // Continue running even if migration/seeding fails
            }
        }
    }
}
catch (Exception ex)
{
    Console.WriteLine($"Critical error during application startup: {ex.Message}");
    Console.WriteLine($"Stack trace: {ex.StackTrace}");
    // Don't rethrow - continue running
}

// Initialize compliance dataset and verify Bedrock on startup
try
{
    using (var scope = app.Services.CreateScope())
    {
        var services = scope.ServiceProvider;
        var logger = services.GetRequiredService<ILogger<Program>>();

        try
        {
            var validationService = services.GetRequiredService<IDocumentValidationService>();
            var datasetPath = Path.Combine(
                AppDomain.CurrentDomain.BaseDirectory,
                "AI", "services", "document_validator", "datasets",
                "cross_border_shipping_restrictions.csv"
            );

            await validationService.InitializeComplianceDatasetAsync(datasetPath);
            logger.LogInformation("Compliance dataset initialized successfully");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error initializing compliance dataset");
            // Continue startup even if dataset fails to load
        }

        // Verify Bedrock is configured
        try
        {
            var bedrockSettings = services.GetRequiredService<IOptions<BedrockSettings>>()?.Value;
            var bedrockClient = services.GetRequiredService<IAmazonBedrockRuntime>();
            if (bedrockSettings?.ModelId != null && bedrockClient != null)
            {
                logger.LogInformation("✓ AWS Bedrock configured: Region={Region}, Model={Model}", 
                    bedrockSettings.Region ?? "us-east-1", 
                    bedrockSettings.ModelId);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "⚠ Bedrock configuration check failed - ensure AWS credentials are set");
        }
    }
}
catch (Exception ex)
{
    Console.WriteLine($"Error during startup initialization: {ex.Message}");
}

// Enable Swagger UI for all environments (local development and testing)
// In production, you may want to disable this or add authentication
app.UseSwagger(c =>
{
    c.RouteTemplate = "swagger/{documentName}/swagger.json";
});

app.UseSwaggerUI(c =>
{
    c.SwaggerEndpoint("/swagger/v1/swagger.json", "PreClear API v1");
    c.RoutePrefix = "swagger"; // Swagger available at /swagger
    c.DefaultModelsExpandDepth(2);
    c.DefaultModelExpandDepth(2);
    c.DocExpansion(Swashbuckle.AspNetCore.SwaggerUI.DocExpansion.List);
    c.EnableValidator();
});

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}

var enableHttps = builder.Configuration.GetValue<bool>("EnableHttpsRedirection", false);
if (enableHttps)
{
    app.UseHttpsRedirection();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

Console.WriteLine($"=== Pre-Clear Backend Ready to Run ===");
Console.WriteLine($"Environment: {app.Environment.EnvironmentName}");
Console.WriteLine($"Listening on: http://localhost:5000");
Console.WriteLine($"Press Ctrl+C to stop");
Console.WriteLine($"====================================");

try
{
    app.Run();
}
catch (Exception ex)
{
    Console.WriteLine($"");
    Console.WriteLine($"FATAL EXCEPTION IN APP.RUN():");
    Console.WriteLine($"Message: {ex.Message}");
    Console.WriteLine($"Type: {ex.GetType().Name}");
    Console.WriteLine($"Stack: {ex.StackTrace}");
    Console.WriteLine($"Inner: {ex.InnerException?.Message}");
    Environment.Exit(1);
}

