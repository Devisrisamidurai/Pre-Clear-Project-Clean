using Microsoft.AspNetCore.Mvc;

namespace PreClear.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class S3TestController : ControllerBase
{
    private readonly PreClear.Api.Interfaces.IS3StorageService _s3Service;

    public S3TestController(PreClear.Api.Interfaces.IS3StorageService s3Service)
    {
        _s3Service = s3Service;
    }

        [HttpPost("upload")]
        public async Task<IActionResult> UploadTest(IFormFile file)
        {
            if (file == null || file.Length == 0)
                return BadRequest("File is empty");

            var key = await _s3Service.UploadFileAsync(file, "test");
            return Ok(new { message = "Upload successful", s3Key = key });
        }
    }
}
