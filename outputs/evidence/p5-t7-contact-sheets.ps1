Add-Type -AssemblyName System.Drawing

$sourceDirectory = Join-Path $PSScriptRoot 'browser\p5-t7'

function New-ContactSheet {
  param(
    [string]$Name,
    [System.IO.FileInfo[]]$Files,
    [int]$Columns = 2
  )

  $tileWidth = 660
  $tileHeight = 520
  $labelHeight = 34
  $padding = 18
  $rows = [Math]::Ceiling($Files.Count / $Columns)
  $width = $Columns * $tileWidth + ($Columns + 1) * $padding
  $height = $rows * ($tileHeight + $labelHeight) + ($rows + 1) * $padding
  $sheet = New-Object System.Drawing.Bitmap($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($sheet)
  $graphics.Clear([System.Drawing.Color]::FromArgb(234, 241, 237))
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $font = New-Object System.Drawing.Font('Segoe UI', 12)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(23, 33, 30))

  try {
    for ($index = 0; $index -lt $Files.Count; $index++) {
      $column = $index % $Columns
      $row = [Math]::Floor($index / $Columns)
      $x = $padding + $column * $tileWidth
      $y = $padding + $row * ($tileHeight + $labelHeight)
      $image = [System.Drawing.Image]::FromFile($Files[$index].FullName)
      try {
        $scale = [Math]::Min(($tileWidth - 10) / $image.Width, ($tileHeight - 10) / $image.Height)
        $drawWidth = [Math]::Max(1, [int]($image.Width * $scale))
        $drawHeight = [Math]::Max(1, [int]($image.Height * $scale))
        $drawX = $x + [int](($tileWidth - $drawWidth) / 2)
        $drawY = $y + [int](($tileHeight - $drawHeight) / 2)
        $graphics.DrawImage($image, $drawX, $drawY, $drawWidth, $drawHeight)
        $graphics.DrawString($Files[$index].Name, $font, $brush, $x, $y + $tileHeight)
      }
      finally {
        $image.Dispose()
      }
    }

    $outputPath = Join-Path $sourceDirectory "review-$Name.png"
    $sheet.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $outputPath
  }
  finally {
    $brush.Dispose()
    $font.Dispose()
    $graphics.Dispose()
    $sheet.Dispose()
  }
}

$all = Get-ChildItem -LiteralPath $sourceDirectory -File -Filter '*.png' | Where-Object { $_.Name -notlike 'review-*' }
New-ContactSheet -Name 'platform' -Files @($all | Where-Object { $_.Name -like 'platform-*' -and $_.Name -notlike '*filmstrip*' } | Sort-Object Name)
New-ContactSheet -Name 'global-tools' -Files @($all | Where-Object { ($_.Name -like 'global-search-*' -or $_.Name -like 'quick-create-*') -and $_.Name -notlike '*filmstrip*' } | Sort-Object Name)
New-ContactSheet -Name 'settings' -Files @($all | Where-Object { $_.Name -like 'settings-??-*' } | Sort-Object Name)
New-ContactSheet -Name 'filmstrips' -Files @($all | Where-Object { $_.Name -like '*filmstrip*' } | Sort-Object Name)
