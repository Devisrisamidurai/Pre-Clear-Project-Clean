using System;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PreClear.Api.Interfaces;
using PreClear.Api.Models;

namespace PreClear.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly IAuthService _auth;

        public AuthController(IAuthService auth) => _auth = auth;

        [HttpPost("signup")]
        public async Task<IActionResult> SignUp([FromBody] SignUpRequest req)
        {
            var user = new User
            {
                FirstName = req.FirstName,
                LastName = req.LastName,
                Email = req.Email,
                Phone = req.Phone ?? string.Empty,
                Company = req.Company ?? string.Empty,
                Role = string.IsNullOrWhiteSpace(req.Role) ? "shipper" : req.Role,
                TosAccepted = req.TosAccepted,
                TosAcceptedAt = req.TosAccepted ? System.DateTime.UtcNow : null,
                EmailVerified = false
            };

            var (success, error, userId) = await _auth.SignUpAsync(user, req.Password);
            if (!success) return BadRequest(new { error });

            // Return created location so it's easy to verify the user in DB
            if (userId.HasValue)
            {
                return CreatedAtAction("Get", "Users", new { id = userId.Value }, new { id = userId.Value, email = user.Email });
            }

            return Created("/api/users", null);
        }

        [HttpPost("signin")]
        public async Task<IActionResult> SignIn([FromBody] SignInRequest req)
        {
            try
            {
                if (req == null || string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                    return BadRequest(new { error = "email_and_password_required" });
                var (success, token, error, userId, role) = await _auth.SignInAsync(req.Email, req.Password);
                if (!success) return Unauthorized(new { error });
                return Ok(new { token, id = userId, role });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { error = ex.Message, detail = ex.StackTrace });
            }
        }

        [HttpPost("change-password")]
        [Authorize]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest req)
        {
            var userIdClaim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            if (!long.TryParse(userIdClaim, out var userId) || userId <= 0)
                return Unauthorized(new { error = "unauthorized" });

            var (success, error) = await _auth.ChangePasswordAsync(userId, req.CurrentPassword, req.NewPassword);
            if (!success) return BadRequest(new { error });

            return NoContent();
        }
    }

    public class SignUpRequest
    {
        public string FirstName { get; set; } = null!;
        public string LastName { get; set; } = null!;
        public string Email { get; set; } = null!;
        public string Password { get; set; } = null!;
        public string? Phone { get; set; }
        public string? Company { get; set; }
        public string? Role { get; set; }
        public bool TosAccepted { get; set; }
    }

    public class SignInRequest
    {
        public string Email { get; set; } = null!;
        public string Password { get; set; } = null!;
    }

    public class ChangePasswordRequest
    {
        public string CurrentPassword { get; set; } = string.Empty;
        public string NewPassword { get; set; } = string.Empty;
    }
}
